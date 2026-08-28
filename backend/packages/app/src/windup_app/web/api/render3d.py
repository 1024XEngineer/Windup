"""母版预检与造型级 3D 资产的端点 —— 前端那道"确认 → 建 → 审"闸的后端一侧。

**本模块不 import ai_engine,也不 import 任何会牵出它的 server 模块**(门禁
"入口层不经 ai_engine 直连"是传递性的)。两件事都经 ``request.app.state`` 上的
运行期注入拿到,与 ``executor`` 走的是同一条路;bootstrap 是唯一的装配点。

代价是这里拿到的是 ``dict`` 而不是带类型的对象,响应模型只能在本文件重写一遍。
这是刻意的:为了标注类型去 import 那边,门禁当场就红。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response
from windup_framework.db import get_session

from windup_app.server.character.model import Character, CharacterData
from windup_app.server.project.model import Project
from windup_common.models import CharacterStance
from windup_app.server.orchestrator import client_bake, task_repo
from windup_app.server.orchestrator._failure import user_message
from windup_app.server.character.service import service as character_service
from windup_app.web.api.character import get_character_with_auth

logger = logging.getLogger("windup.render3d.api")

router = APIRouter(prefix="/render3d", tags=["render3d"])


class BuildAssetRequest(BaseModel):
    """建 3D 资产的入参。

    ``stance`` 必填、无默认:自动绑骨只支持双足,而四足/无肢从模型几何判不出来
    (实测归档模型的包围盒比例完全重叠)。给默认值等于把「没声明」当成「双足」放行。
    """

    stance: CharacterStance


class MasterPrecheckRequest(BaseModel):
    """要预检的母版。只收自家对象存储的 URL —— 服务端替调用方拉任意地址等于把服务器
    当跳板,见 ``orchestrator._fetch``。"""

    image_url: str = Field(..., min_length=1)
    canvas_width: int | None = Field(default=None, gt=0)
    canvas_height: int | None = Field(default=None, gt=0)


def _operations(request: Request):
    """建资产的四个动作。没装配就明说,别让端点抛 AttributeError。"""
    operations = getattr(request.app.state, "render3d_operations", None)
    if operations is None:
        raise BizException("三渲二资产服务未装配", code=BizCode.INTERNAL_ERROR)
    return operations


def _precheck(request: Request):
    precheck = getattr(request.app.state, "precheck_master", None)
    if precheck is None:
        raise BizException("母版预检服务未装配", code=BizCode.INTERNAL_ERROR)
    return precheck


#: 每个用户最多同时持有的 3D 资产数。
#:
#: 这条是**产品限额**不是技术限制:一个 3D 资产 = 图生 3D 20 积分 + 绑骨 10 积分,
#: 且后续动作全部复用它,所以它是这条路线上唯一的重成本点。
MAX_ASSETS_PER_USER = 2


def _owned_asset_count(session: Session, user_id: int) -> int:
    """该用户名下已经建成的 3D 资产数。

    数的是**当前持有**而不是历史建过多少次 —— 弃掉一个就释放一个名额。理由是混元的
    模型生成即最终、改不动,不合格只能弃掉重建;名额若不释放,两个坏模型就把用户永久
    卡死在这条路线外面。

    只数已落 ``model_3d_url`` 的。建造中的不计入:那需要逐造型去问资产存储,而并发建多个
    的代价本来就由积分挡着(每个都真金白银扣),不值得为它多打一圈存储。
    """
    rows = session.execute(
        select(Character.character_data)
        .join(Project, Character.project_id == Project.id)
        .where(Project.user_id == user_id)
    ).scalars().all()
    owned = 0
    for data in rows:
        for outfit in (data or {}).get("outfits", []):
            if outfit.get("model_3d_url"):
                owned += 1
    return owned


def _asset_key(character_id: int, outfit_id: str) -> str:
    """3D 资产落点的键。**必须带上角色 id**:``outfit_id`` 只在所属角色内唯一,
    而工作流给首个造型的 id 是写死的 ``outfit-default`` —— 只用它当键,全站每个角色
    的默认造型会共用同一个 3D 模型,表现为"别人的角色套着我的模型",且没有任何报错。
    """
    return f"character-{character_id}/{outfit_id}"


def _outfit_or_raise(character: Character, outfit_id: str) -> dict:
    for outfit in (character.character_data or {}).get("outfits", []):
        if outfit.get("id") == outfit_id:
            return outfit
    raise BizException("造型不存在", code=BizCode.NOT_FOUND)


def _master_url_or_raise(outfit: dict) -> str:
    """建资产用的母版就是造型的定妆母版。

    没有它就不能往下走:图生 3D 的入参只有这一张图,拿角色参考图顶替会建出另一个造型
    的模型,而接口照常成功、照常扣积分。
    """
    url = outfit.get("preview_url")
    if not url:
        raise BizException(
            "该造型还没有已确认的定妆母版,先在工作流里确认母版再建 3D 资产",
            code=BizCode.BAD_REQUEST,
        )
    return url


def _sync_model_url(
    session: Session,
    character: Character,
    outfit_id: str,
    url: str | None,
    motion: str | None = None,
) -> None:
    """把建好的模型 URL 回写到 ``character_data``。

    回写发生在**读状态**这一步而不是后台线程里:后台线程没有请求作用域的 session,
    而三渲二那条路线的判据(``Outfit.model_3d_url``)不回写就永远是 None —— 资产建好了
    却依旧显示"该造型暂无绑骨 3D 模型",钱白花。

    ``motion`` 给出这一份产物烘的是哪个动作,写进 ``rigged_motions``。一份绑骨产物只带
    一个动作片段(接口一次只吃一个 MotionType),所以多动作 = 多份产物 = 这张表多几条;
    **不能覆盖** ``model_3d_url`` —— 覆盖了的话用户为第二个动作付的钱会把第一个顶掉。
    ``model_3d_url`` 只在它还空着时写(即主产物那一次)。
    """
    if not url:
        return
    data = CharacterData.model_validate(character.character_data or {})
    changed = False
    for outfit in data.outfits:
        if outfit.id != outfit_id:
            continue
        # 只有说得出这一份烘的是哪个动作时才记进表。说不出就只写主产物别名 ——
        # 猜一个动作名记进去,等于声称这个资产会一个它其实不会的动作。
        if motion and outfit.rigged_motions.get(motion) != url:
            outfit.rigged_motions[motion] = url
            changed = True
        # 主产物那一次(第一份)同时写别名槽,后续动作不再动它。
        if not (outfit.model_3d_url or "").strip():
            outfit.model_3d_url = url
            changed = True
    if not changed:
        return
    character_service.update_character(session, character.id, character_data=data.model_dump())


@router.post("/master-precheck", response_model=Response[dict])
def precheck_master(
    body: MasterPrecheckRequest,
    request: Request,
) -> Response[dict]:
    """零成本母版预检。**不产生任何按次计费调用**,可以在确认闸上随便调。"""
    canvas = (
        (body.canvas_width, body.canvas_height)
        if body.canvas_width and body.canvas_height
        else None
    )
    try:
        report = _precheck(request)(body.image_url, canvas)
    except ValueError as exc:
        raise BizException(user_message(exc), code=BizCode.BAD_REQUEST) from exc
    return Response.success(report)


@router.get("/characters/{character_id}/outfits/{outfit_id}", response_model=Response[dict])
def get_outfit_asset(
    character_id: int,
    outfit_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    user_id = request.state.current_user.id
    character = get_character_with_auth(session, character_id, user_id)
    _outfit_or_raise(character, outfit_id)
    view = _operations(request).view(_asset_key(character_id, outfit_id))
    _sync_model_url(session, character, outfit_id, view["model_3d_url"],
                    motion=view.get("primary_motion"))
    return Response.success(view)


@router.post("/characters/{character_id}/outfits/{outfit_id}/build", response_model=Response[dict])
def build_outfit_asset(
    character_id: int,
    outfit_id: str,
    body: BuildAssetRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    """启动图生 3D。**按次计费的触发点**,所以只认用户的显式请求,不在任何自动路径上。"""
    user_id = request.state.current_user.id
    character = get_character_with_auth(session, character_id, user_id)
    outfit = _outfit_or_raise(character, outfit_id)
    owned = _owned_asset_count(session, user_id)
    if owned >= MAX_ASSETS_PER_USER:
        raise BizException(
            f"每个账号最多同时持有 {MAX_ASSETS_PER_USER} 个 3D 角色，你已经有 {owned} 个。"
            "弃掉其中一个就能再建。",
            code=BizCode.BAD_REQUEST,
        )
    operations = _operations(request)
    try:
        return Response.success(
            operations.build(_asset_key(character_id, outfit_id),
                             _master_url_or_raise(outfit), body.stance),
            message="已开始生成 3D 模型",
        )
    except ValueError as exc:
        raise BizException(user_message(exc), code=BizCode.BAD_REQUEST) from exc


@router.post("/characters/{character_id}/outfits/{outfit_id}/approve", response_model=Response[dict])
def approve_outfit_asset(
    character_id: int,
    outfit_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    """人看过模型并点头 → 继续绑骨。**唯一的放行入口**,没有超时自动放行。"""
    user_id = request.state.current_user.id
    character = get_character_with_auth(session, character_id, user_id)
    outfit = _outfit_or_raise(character, outfit_id)
    try:
        view = _operations(request).approve(
            _asset_key(character_id, outfit_id), _master_url_or_raise(outfit)
        )
    except ValueError as exc:
        raise BizException(user_message(exc), code=BizCode.BAD_REQUEST) from exc
    return Response.success(view, message="已放行,开始绑骨")


class AddMotionRequest(BaseModel):
    """给已建好的 3D 资产追加一个动作片段。

    ``motion`` 取 ``render3d_assets.ACTION_MOTIONS`` 里有对应预设的那几个
    (walk / idle / jump);attack 与 custom 没有对应预设,继续走 i2v。
    """

    motion: str = Field(..., min_length=1)


@router.post("/characters/{character_id}/outfits/{outfit_id}/motions", response_model=Response[dict])
def add_outfit_motion(
    character_id: int,
    outfit_id: str,
    body: AddMotionRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    """给已建好的造型再烘一个动作片段。**按次计费的触发点**,只认用户的显式请求。

    只花绑骨那一笔:图生 3D 的产物一直留着,不重付。一份绑骨产物只带一个动作片段
    (接口一次只吃一个 MotionType),所以"这个角色会走也会跳"= 两份产物。
    """
    user_id = request.state.current_user.id
    character = get_character_with_auth(session, character_id, user_id)
    _outfit_or_raise(character, outfit_id)
    operations = _operations(request)
    key = _asset_key(character_id, outfit_id)
    try:
        view = operations.add_motion(key, body.motion)
    except ValueError as exc:
        raise BizException(user_message(exc), code=BizCode.BAD_REQUEST) from exc
    # 回写:这一份产物记在它自己那个动作名下,不覆盖主产物。
    # 用**这一份**产物的 URL,不是 view 里那个主产物的 —— 记错了就是拿走路冒充跳跃。
    _sync_model_url(session, character, outfit_id,
                    view.get("motion_model_url"), motion=body.motion)
    return Response.success(view, message=f"已为 {body.motion} 绑骨并烘入动作")


@router.post("/characters/{character_id}/outfits/{outfit_id}/discard", response_model=Response[dict])
def discard_outfit_asset(
    character_id: int,
    outfit_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    """模型不合格 → 丢弃重来。混元的模型改不动,这是唯一的补救。"""
    user_id = request.state.current_user.id
    character = get_character_with_auth(session, character_id, user_id)
    _outfit_or_raise(character, outfit_id)
    try:
        view = _operations(request).discard(_asset_key(character_id, outfit_id))
    except ValueError as exc:
        raise BizException(user_message(exc), code=BizCode.BAD_REQUEST) from exc
    return Response.success(view, message="已丢弃待审模型")


# ── 浏览器出帧(#714)────────────────────────────────────────────────────────
# 出帧那一段在用户浏览器里跑:应用机不起 Chromium、不做软件光栅、模型一个字节都不经过它。
# 本段四个端点只搬运与校验,渲染参数由 ai_engine 的 RenderPlan 定,这里不重写一份。


class BakeRigFacts(BaseModel):
    """浏览器出帧台读到的骨架事实。**记录用,不是判据** —— 以骨数/命名当闸已被实测推翻。"""

    bones: int = Field(default=0, ge=0)
    root_bone: str | None = None
    bone_names: list[str] = Field(default_factory=list)
    skinned_meshes: int = Field(default=0, ge=0)
    vertices: int = Field(default=0, ge=0)
    available_clips: dict[str, float] = Field(default_factory=dict)


class BakeCompleteRequest(BaseModel):
    """浏览器自报交齐了。帧本身已逐帧 POST 上来,这里带回可对账的采样信息与派生资产。

    ``rig`` / ``root_motion`` 与服务端渲那条交回的是同一批数(#774):两条路存下来的
    资产必须一样,否则同一造型走哪条路建出来的东西不同,而没有一处会红。
    """

    clip: str = Field(..., min_length=1)
    sample_times: list[float] = Field(default_factory=list)
    rig: BakeRigFacts | None = None
    root_motion: list[tuple[float, float]] | None = None


class BakeFailRequest(BaseModel):
    """浏览器自报渲不出来(WebGL 起不来 / 模型加载失败 / 用户关了页面前的兜底)。"""

    reason: str = Field(default="", max_length=200)


def _own_task_or_raise(session: Session, request: Request, task_id: int):
    """出帧任务必须属于当前用户 —— 帧是产物,谁都能往里塞就等于谁都能改别人的交付。"""
    task = task_repo.get_task_by_user(session, request.state.current_user.id, task_id)
    if task is None:
        raise BizException("任务不存在", code=BizCode.NOT_FOUND)
    return task


@router.get("/bake/{task_id}", response_model=Response[dict])
def get_bake_job(
    task_id: int,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    """取这个任务的出帧参数。没有登记就是不需要浏览器出帧(或已收口)。"""
    _own_task_or_raise(session, request, task_id)
    view = client_bake.public_view(task_id)
    if view is None:
        raise BizException("该任务没有待浏览器出帧的登记", code=BizCode.NOT_FOUND)
    return Response.success(view)


@router.post("/bake/{task_id}/frames/{index}", response_model=Response[dict])
async def put_bake_frame(
    task_id: int,
    index: int,
    request: Request,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> Response[dict]:
    """收一帧 PNG。逐帧收而不是一次收一整包:32 帧一起传要几十 MB 的请求体常驻内存。"""
    _own_task_or_raise(session, request, task_id)
    data = bytearray()
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        if len(data) + len(chunk) > client_bake.MAX_FRAME_BYTES:
            raise BizException(
                f"单帧超过上限 {client_bake.MAX_FRAME_BYTES // 1024} KB",
                code=BizCode.BAD_REQUEST,
            )
        data.extend(chunk)
    try:
        received = client_bake.put_frame(task_id, index, bytes(data))
    except client_bake.ClientBakeError as exc:
        raise BizException(str(exc), code=BizCode.BAD_REQUEST) from exc
    return Response.success({"task_id": task_id, "index": index, "received": received})


@router.post("/bake/{task_id}/complete", response_model=Response[dict])
def complete_bake(
    task_id: int,
    body: BakeCompleteRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    """帧交齐 → 交回 worker 续跑后处理。

    **不信前端说交齐了**:这里按登记的帧数点数,少一帧就不放行 —— 少给的后果是一段
    步子没走完的动作,而帧数、时长、成色在下游全都自洽,没有一道会红。
    """
    _own_task_or_raise(session, request, task_id)
    loaded = client_bake.load_spec(task_id)
    if loaded is None:
        raise BizException("该任务没有待浏览器出帧的登记", code=BizCode.NOT_FOUND)
    spec, _deadline = loaded
    if body.clip != spec.clip:
        raise BizException(
            f"交回的片段是 {body.clip!r},登记的是 {spec.clip!r}", code=BizCode.BAD_REQUEST
        )
    try:
        client_bake.collect_frames(task_id, spec.frames)
    except client_bake.ClientBakeError as exc:
        raise BizException(str(exc), code=BizCode.BAD_REQUEST) from exc
    client_bake.save_derived(
        task_id,
        rig=body.rig.model_dump() if body.rig else None,
        root_motion=[list(pair) for pair in body.root_motion] if body.root_motion else None,
    )
    client_bake.schedule_resume(task_id)
    return Response.success(
        {"task_id": task_id, "frames": spec.frames}, message="帧已交齐,继续后处理"
    )


@router.post("/bake/{task_id}/fail", response_model=Response[dict])
def fail_bake(
    task_id: int,
    body: BakeFailRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    """浏览器自报渲不出来。早报早失败、早解冻,不必等到期限耗完。"""
    _own_task_or_raise(session, request, task_id)
    if client_bake.load_spec(task_id) is None:
        raise BizException("该任务没有待浏览器出帧的登记", code=BizCode.NOT_FOUND)
    client_bake.schedule_resume(
        task_id, reason=client_bake.REASON_CLIENT_FAILED, detail=body.reason
    )
    return Response.success({"task_id": task_id}, message="已记为出帧失败")
