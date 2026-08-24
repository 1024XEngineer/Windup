"""母版出图那一步的抠图与主体数读数(#430 / #427)。

两条 issue 改的是同一处出口,共用同一次 ``cutout()``:抠出来的 alpha 既是交付物,
也是数主体数的依据。分两次插 matte 会让同一张图被抠两遍,还可能抠出两份不同的 alpha。

抠图 provider 在这里桩替。真实那份走 u2netp(``test_matte_provider.py`` 校准),
本文件要锁的是**生产路径确实过了它**,以及读数确实落到任务结果里 —— 这正是
"端点看着可用、实际没接上"那类事故的防线。
"""

import io
import threading

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from windup_app.server.orchestrator.executor import ImageTaskExecutor, ProjectConstraints
from windup_app.server.orchestrator.model import CharacterImageInput, TaskStatus
from windup_app.server.orchestrator.service import AiGenerationService
from windup_framework.db.base import Base
from windup_framework.mq.model import MqMessage  # noqa: F401 — register metadata

from conftest import seed_credit_account

_BG = (200, 200, 200)  # 提示词里那句 "Plain light-gray background"


@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _master(size: int = 64, *, subjects: int = 1) -> bytes:
    """模型刚出的母版:浅灰底 + 若干互不相连的主体块,**整幅不透明**。"""
    arr = np.zeros((size, size, 4), "uint8")
    arr[:, :, :3] = _BG
    arr[:, :, 3] = 255
    for i in range(subjects):
        x = 6 + i * (size // 2)
        arr[20:44, x:x + 18, :3] = (30, 60, 200)
    buf = io.BytesIO()
    Image.fromarray(arr, "RGBA").save(buf, "PNG")
    return buf.getvalue()


class _BackgroundMatte:
    """把浅灰底判成背景。真 provider 按显著性分割,这里只需要一份确定的 alpha。"""

    def __init__(self) -> None:
        self.calls = 0

    def cutout(self, png: bytes) -> bytes:
        self.calls += 1
        arr = np.asarray(Image.open(io.BytesIO(png)).convert("RGBA")).copy()
        bg = np.all(np.abs(arr[:, :, :3].astype(int) - np.array(_BG)) <= 8, axis=-1)
        arr[bg, 3] = 0
        buf = io.BytesIO()
        Image.fromarray(arr, "RGBA").save(buf, "PNG")
        return buf.getvalue()


class _Gen:
    def __init__(self, png: bytes) -> None:
        self._png = png

    def gen_image(self, prompt, refs):
        return self._png


def _constraints(size: int = 64) -> ProjectConstraints:
    return ProjectConstraints(sprite_w=size, sprite_h=size)


def _run(png: bytes, *, matte=None, num_images: int = 1, want: int = 64):
    got: list[bytes] = []
    n = 0
    lock = threading.Lock()

    def _upload(b: bytes) -> str:
        nonlocal n
        with lock:
            n += 1
            got.append(b)
            return f"u{n}"

    ex = ImageTaskExecutor(
        image=_Gen(png),
        matte=matte or _BackgroundMatte(),
        upload=_upload,
    )
    urls, quality = ex._produce_image(
        CharacterImageInput(prompt="勇者", width=want, height=want, num_images=num_images),
        _constraints(want),
    )
    return got, urls, quality


def _alpha(png: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(png)).convert("RGBA"))[:, :, 3]


def _geometry(png: bytes) -> tuple[float, float]:
    """主体的高度占幅与脚线位置,都取比例 —— 换画布尺寸不该改变这两个数。"""
    a = _alpha(png)
    rows = np.where(a.max(axis=1) > 128)[0]
    return (rows.max() + 1 - rows.min()) / a.shape[0], (rows.max() + 1) / a.shape[0]


def test_delivered_master_has_no_background_left():
    """#430:交上去的那份必须是抠过的,不是模型原样。

    断言落在**上传拿到的字节**上,而不是"抠图被调用过"—— 调用了却把原图传上去
    同样能让调用计数通过,而用户看到的仍是灰底。
    """
    raw = _master()
    assert _alpha(raw)[0, 0] == 255, "仪器自检:模型出的图本就该是不透明的"

    got, _, _ = _run(raw)

    assert _alpha(got[0])[0, 0] == 0
    assert _alpha(got[0])[20:44, 6:24].min() == 255, "主体不能被一起抠掉"


def test_master_smaller_than_canvas_is_scaled_up_not_pasted():
    """#512:源图小于项目画布时,主体占幅与脚线必须原样保住。

    断言几何而不是画布尺寸:把 64 的图原尺寸居中贴进 256 画布,尺寸一样是对的,
    可主体只剩四分之一大、脚线跟着上移,而母版是交付物,后面没有环节补得回来。
    """
    src = _master(size=64)
    want_span, want_foot = _geometry(_BackgroundMatte().cutout(src))
    assert want_span == pytest.approx(0.375), "仪器自检:源图主体占满高度的 3/8"

    got, _, _ = _run(src, want=256)

    assert Image.open(io.BytesIO(got[0])).size == (256, 256)
    span, foot = _geometry(got[0])
    assert span == pytest.approx(want_span, abs=0.01)
    assert foot == pytest.approx(want_foot, abs=0.01)


def test_multi_subject_master_is_counted_at_the_image_exit():
    """#427:两个主体在出图当场就留痕,不必等下一个动作任务。"""
    _, _, quality = _run(_master(subjects=2))

    assert quality["subject_blobs"] == [2]


def test_single_subject_master_counts_one():
    _, _, quality = _run(_master(subjects=1))

    assert quality["subject_blobs"] == [1]


def test_each_image_gets_its_own_reading():
    """读数逐张给,不压成均值:一次出四张里只有一张是双主体,均值会把它抹平。"""
    _, urls, quality = _run(_master(subjects=2), num_images=3)

    assert len(urls) == 3
    assert quality["subject_blobs"] == [2, 2, 2]


def test_cutout_failure_fails_the_task_instead_of_delivering_gray():
    """抠不动时任务该红。静默交一张带灰底的母版正是 #430 本身,而且不可检测。"""
    class _Broken:
        def cutout(self, png: bytes) -> bytes:
            raise RuntimeError("onnxruntime 不可用")

    with pytest.raises(RuntimeError):
        _run(_master(), matte=_Broken())


def test_quality_reaches_the_task_result_over_http(session_factory):
    """从建任务到读任务走真实链路:读数必须能被前端拿到。

    直接构造 ``CharacterImageOutput`` 的测试证明不了这条 —— 它绕过了 executor 落库
    与 ``task_repo`` 反序列化那两段,而字段漏在哪一段都会让接口那头恒为空。
    """
    with session_factory() as session:
        seed_credit_account(session, 1)
        session.commit()

    image_input = CharacterImageInput(prompt="勇者", width=64, height=64, num_images=1)
    with session_factory() as session:
        task = AiGenerationService().generate_character_image(
            session, user_id=1, input=image_input,
        )
        session.commit()
        task_id = task.id

    ImageTaskExecutor(
        image=_Gen(_master(subjects=2)),
        matte=_BackgroundMatte(),
        upload=lambda _b: "https://cdn.example.com/m.png",
        session_factory=session_factory,
    ).run_image_task(task_id, image_input)

    with session_factory() as session:
        done = AiGenerationService().get_task(session, project_id=1, task_id=task_id)

    assert done.status is TaskStatus.COMPLETED
    assert done.result.quality == {"subject_blobs": [2]}


def test_multi_image_generation_keeps_slot_count_when_calls_overlap():
    """num_images>1 并行打模型,交付条数仍等于请求条数。"""
    threads: set[int] = set()
    lock = threading.Lock()
    started = threading.Barrier(3)

    class _SlowGen:
        def gen_image(self, prompt, refs):
            del prompt, refs
            with lock:
                threads.add(threading.get_ident())
            started.wait(timeout=2)
            return _master()

    ex = ImageTaskExecutor(
        image=_SlowGen(),
        matte=_BackgroundMatte(),
        upload=lambda b: f"u-{id(b)}",
    )
    urls, quality = ex._produce_image(
        CharacterImageInput(prompt="勇者", width=64, height=64, num_images=3),
        _constraints(),
    )
    assert len(urls) == 3
    assert quality["subject_blobs"] == [1, 1, 1]
    assert len(threads) > 1
