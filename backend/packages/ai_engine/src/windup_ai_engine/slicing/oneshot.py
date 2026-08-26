"""一次性动作(jump / attack / hit)的抽帧:裁动作起止 + 按状态切段。

与循环类(idle/walk/run)的根本差别:
- 循环类用 :mod:`.loop` 找步态周期抽单周期闭环;一次性动作**不能闭环** —— 首尾姿态不同,
  强行闭环会把落地帧接回蓄力帧,读起来是抽搐。
- i2v 出的 5s 视频里,真正的动作往往只占中间一段(前后是静止的起手/终态保持),直接均匀
  抽帧会浪费一半帧在不动的地方 → 需要先**裁到动作发生的区间**。
- jump 还要进一步**按状态切段**(蓄力/上升/顶点/下降/落地),因为引擎里悬空时长由物理
  决定、上升中可被打断,必须能分段播放。

纯 numpy / PIL,零 API。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from windup_ai_engine._subject import subject_mask as _subject_mask

__all__ = [
    "find_motion_span",
    "first_action_end",
    "pick_oneshot",
    "pick_oneshot_indices",
    "split_jump_phases",
    "foot_line_series",
]


_KINDS = ("swing", "airborne")

# 脚线回地容差按画高归一。6px 是 720p i2v 上的轻微抖动;48×48 预览若仍用 6px,
# 等于约 12.5% 画高,下降段会提前被当成落地。
_AIRBORNE_LAND_REL = 6.0 / 720.0


def _check_kind(kind: str) -> None:
    """未知 ``kind`` 直接报错,不静默回落到 ``swing``。

    两个判据的物理不同(脚线回地 vs 能量跌破),拼错一个字母(``"airbourne"``)若被当成
    ``swing`` 处理,跳跃会按能量判据裁 —— 出的是"看起来成功"的错区间(实测:顶点悬停处
    能量安静,动作被截在半空),而这类错误在序列帧里很难回溯到 kind 拼错上。
    """
    if kind not in _KINDS:
        raise ValueError(f"kind 只能是 'swing' 或 'airborne',收到 {kind!r}")


def _frame_energy(frames: list[Image.Image], size: int = 64) -> np.ndarray:
    """逐帧与前一帧的差异强度(灰度小图),长度 = len(frames)-1。"""
    gs = [np.asarray(f.convert("L").resize((size, size)), dtype=np.float32) for f in frames]
    return np.array([np.abs(gs[i + 1] - gs[i]).mean() for i in range(len(gs) - 1)])


def find_motion_span(frames: list[Image.Image], rel_thr: float = 0.25) -> tuple[int, int]:
    """定位"动作真正发生"的帧区间 ``[start, end]``(含端点)。

    以帧间差异强度超过峰值 ``rel_thr`` 倍的最早/最晚位置为界,并各留一帧余量。
    静止的起手与终态保持会被裁掉。
    """
    if len(frames) < 3:
        return 0, len(frames) - 1
    e = _frame_energy(frames)
    peak = float(e.max())
    if peak <= 1e-6:
        return 0, len(frames) - 1
    active = np.flatnonzero(e >= peak * rel_thr)
    if not len(active):
        return 0, len(frames) - 1
    start = max(0, int(active[0]) - 1)
    end = min(len(frames) - 1, int(active[-1]) + 2)
    return start, end


def _land_tol_px(frame: Image.Image) -> float:
    """回地容差(像素)= 720p 上 6px 所占画高比例 × 当前帧高。"""
    return _AIRBORNE_LAND_REL * max(frame.size[1], 1)


def _airborne_end(frames: list[Image.Image], start: int, end: int) -> int:
    """腾空类(jump)的结束:脚线越过最高点后**首次回到地面**。

    几何信号,明确无歧义 —— 比任何"能量安静"判据都稳。
    容差随画高缩放,选帧吃 48×48 预览时仍等价于源分辨率上约 6px。
    """
    y = foot_line_series(frames[start : end + 1])
    if len(y) < 4:
        return end
    apex = int(np.argmin(y))
    ground = float(np.median([y[0], y[-1]]))
    back = np.flatnonzero(y[apex:] >= ground - _land_tol_px(frames[start]))
    return min(end, start + apex + int(back[0]) + 2) if len(back) else end


def _swing_end(frames: list[Image.Image], start: int, end: int,
               drop_ratio: float = 0.35, recover: int = 2) -> int:
    """挥击类(attack/hit)的结束:能量越过峰值后**首次跌到峰值的 ``drop_ratio``**,再留收势余量。

    挥击是"蓄力 → 峰值 → 收势"的单峰结构,收势很短,故用"跌破比例 + 固定余量"即可;
    不要求长时间静止 —— 实测挥砍收势段的能量并不干净(视频压缩噪点),等不到静止平台。
    """
    e = _frame_energy(frames[start : end + 1])
    if len(e) < 4:
        return end
    peak_i = int(np.argmax(e))
    thr = float(e.max()) * drop_ratio
    for i in range(peak_i + 1, len(e)):
        if e[i] < thr:
            return min(end, start + i + recover)
    return end


def first_action_end(
    frames: list[Image.Image], start: int, end: int, kind: str = "swing"
) -> int:
    """在 ``[start, end]`` 内找**第一次**动作的结束帧,按动作物理分流。

    i2v 常在 5s 里把一次性动作**复读第二遍**(实测:提示词写了 "ONCE",兽人跳了两次、
    挥砍也挥了两次),不裁会把两次动作压进一套序列帧。

    不同动作的"结束"信号本质不同,**一个通用判据管不了两种**(实测踩过):
      - ``kind="airborne"``(jump):脚线回到地面 —— 几何、无歧义。
      - ``kind="swing"``(attack/hit):能量跌破峰值比例 + 收势余量。

    三个已验证无效的通用解法(别再试):①只看"帧间安静" → 在跳跃**顶点悬停**处误触发,
    把动作截在半空;②要求静止段足够长 → 挥砍收势并不干净(压缩噪点),等不到,完全不裁;
    ③找"回到起始姿态"的谷底 → 收势姿态(戒备)与起始姿态(蓄力)不同,回不到低位。
    """
    _check_kind(kind)                            # 放在早返回之前:短区间也不能放过拼错的 kind
    if end - start < 4:
        return end
    return (_airborne_end if kind == "airborne" else _swing_end)(frames, start, end)


def _key_pose(span: list[Image.Image], kind: str) -> int:
    """区间内最能代表这次动作的单帧下标(关键姿势)。

    只取一帧时不能取区间首帧或中点:
      - 首帧是蓄力起手,和待机几乎一个样,单看认不出这是攻击还是跳跃;末帧是收势/落地,同理。
      - 中点也不行:动作区间前后不对称(蓄力长、收势短 —— :func:`_swing_end` 只留 2 帧余量),
        中点会落进蓄力段。
    故取"关键姿势":判据与 :func:`first_action_end` 同源,不引入新参数 ——
    ``airborne`` 取脚线最高(顶点),``swing`` 取能量峰。能量是**帧间**差(长度 len-1),
    峰值下标 i 表示 i→i+1 这一跳变化最大,故取 i+1 = 刚完成最快一段位移的那一帧(命中瞬间)。
    """
    if len(span) < 2:
        # 单帧区间:答案唯一(就那一帧),没有歧义,不必炸。当前 pick_oneshot 恒给 >= 2 帧
        # (end 至少 start+1),但那是上游三个启发式判据合出来的保证、不是本函数签名的保证,
        # 故留这一行 —— 否则 _frame_energy 会交出空数组、argmax 抛一个看不懂的 numpy 错。
        return 0
    if kind == "airborne":
        return int(np.argmin(foot_line_series(span)))
    return min(len(span) - 1, int(np.argmax(_frame_energy(span))) + 1)


def _widen_span(start: int, end: int, n: int, total: int) -> tuple[int, int]:
    """区间不足 n 帧时把窗口放宽回来,保证能取出 n 个**互不相同**的源帧。

    调用处已保证 ``total > n``,即源帧数是够的 —— 区间短只是我们自己的裁剪判据收得紧
    (2026-08-10 实测:14 帧输入裁到 9 帧区间,请求 12 帧只回 9 帧)。此时既不该报错(源帧够),
    更不该静默少给帧:下游 ``frame_durations(action, len(frames))`` 按实际长度现算时长,帧数与
    时长表自洽,server 看不出异常,用户拿到的是一段步子没走完的动作。故按缺口对称放宽,
    宁可带上几帧起手/收势的静止帧,也要给足请求的帧数。

    动作贴在视频尾部时右边长不动,缺口必须退回左边补(最后一行),否则窗口仍不足 n 帧、
    只能靠重复帧凑数 —— 长度对、内容卡顿,又是一种"看起来成功"。
    """
    deficit = n - (end - start + 1)
    if deficit <= 0:
        return start, end
    left = min(start, (deficit + 1) // 2)          # 先往左补一半,左边不够就全从右边补
    start -= left
    end = min(total - 1, end + deficit - left)
    return max(0, end - n + 1), end                # 右边撞到尾部时把缺口退回左边


def pick_oneshot_indices(
    frames: list[Image.Image], n: int, first_only: bool = True, kind: str = "swing"
) -> list[int]:
    """与 :func:`pick_oneshot` 同一套裁区间 / 关键姿势判据,只返回源下标。"""
    _check_kind(kind)                              # first_only=False 时不走 first_action_end,这里兜住
    if n <= 0:
        # 2026-08-10 实测:n<=0 原本静默返回 [](range(n) 为空,连除零都不报),"成功"地交出零帧。
        raise ValueError(f"n 必须 >= 1,收到 {n}")
    if len(frames) < n:
        raise ValueError(f"源帧不足:请求 {n} 帧,只有 {len(frames)} 帧")
    if len(frames) == n:
        return list(range(n))
    start, end = find_motion_span(frames)
    if first_only:
        end = max(start + 1, first_action_end(frames, start, end, kind=kind))
    start, end = _widen_span(start, end, n, len(frames))
    span = frames[start : end + 1]
    if n == 1:                                     # n=1 撞下面的 /(n-1) 除零(机器审 P1,2026-08-10 复现)
        return [start + _key_pose(span, kind)]
    return [start + round(i * (len(span) - 1) / (n - 1)) for i in range(n)]


def pick_oneshot(
    frames: list[Image.Image], n: int, first_only: bool = True, kind: str = "swing"
) -> list[Image.Image]:
    """一次性动作抽 ``n`` 帧:裁到动作区间 → 只留第一次动作 → 区间内均匀取(不闭环)。

    ``first_only`` 默认开:防 i2v 在 5s 内复读第二遍动作被一起抽进来。
    ``kind``:``"airborne"``(jump,按脚线回地判结束)或 ``"swing"``(attack/hit,按能量跌破判)。

    返回长度**恒等于** ``n``;源帧不够 n 帧则报错,不静默少给。
    """
    idx = pick_oneshot_indices(frames, n, first_only=first_only, kind=kind)
    if n == len(frames):
        return frames
    return [frames[i] for i in idx]


def _subject_rows(frame: Image.Image, alpha_thr: int = 128, bg_tol: int = 60) -> np.ndarray:
    """主体所在的行下标。判据本身在 :mod:`.._subject`(与母版预检共用同一个主体定义)。"""
    return np.where(_subject_mask(frame, alpha_thr, bg_tol))[0]


def foot_line_series(frames: list[Image.Image], alpha_thr: int = 128) -> np.ndarray:
    """逐帧主体**底边** y 坐标(脚线)。跳跃时脚线先降(蹲)、再升(腾空)、再落回。"""
    out = []
    for f in frames:
        ys = _subject_rows(f, alpha_thr)
        out.append(float(ys.max()) if len(ys) else np.nan)
    arr = np.array(out, dtype=np.float32)
    if np.isnan(arr).any():                      # 空帧用邻近值补
        idx = np.arange(len(arr))
        good = ~np.isnan(arr)
        if good.any():
            arr = np.interp(idx, idx[good], arr[good])
        else:
            arr = np.zeros_like(arr)
    return arr


def split_jump_phases(frames: list[Image.Image]) -> dict[str, list[int]]:
    """按脚线轨迹把跳跃切成 crouch / rise / apex / fall / land 五段,返回每段的帧下标。

    判据:脚线 y 越小 = 人越高。最高点(y 最小)即 apex;起跳前脚线最低(蹲)处为 crouch
    结束;之后到 apex 为 rise,apex 之后到脚线回到地面高度为 fall,余下为 land。
    只依赖几何,不依赖模型。
    """
    n = len(frames)
    if n < 5:
        return {"rise": list(range(n))}
    y = foot_line_series(frames)
    apex = int(np.argmin(y))                     # 最高点
    ground = float(np.median([y[0], y[-1]]))     # 地面脚线
    # 起跳点:apex 之前脚线最低(数值最大 = 蹲得最深)的位置
    takeoff = int(np.argmax(y[: max(1, apex)])) if apex > 0 else 0
    # 落地点:apex 之后脚线首次回到地面附近
    after = y[apex:]
    back = np.flatnonzero(after >= ground - 2)
    landing = apex + int(back[0]) if len(back) else n - 1

    apex_lo = max(takeoff + 1, apex - 1)
    apex_hi = min(landing - 1, apex + 1)
    phases = {
        "crouch": list(range(0, takeoff + 1)),
        "rise": list(range(takeoff + 1, apex_lo)),
        "apex": list(range(apex_lo, apex_hi + 1)),
        "fall": list(range(apex_hi + 1, landing)),
        "land": list(range(landing, n)),
    }
    return {k: v for k, v in phases.items() if v}
