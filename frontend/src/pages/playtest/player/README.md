# Playtest Player

独立核验台的播放渲染边界。只维护播放进度等瞬时状态，不修改帧、动作、角色或工作流。

未来只读消费 `Frame.durationMs`、`Frame.rootMotion`、`Action.keyFrameIndex` 和 `Action.fps`：逐帧时长
缺失时才按 fps 等时长回退；根位移以 px 表示、相对首帧且 y 向上为正，null 时不施加位移。
Issue #63 仍开放；当前不实现播放器、字段校验、数据修改或后端映射。

