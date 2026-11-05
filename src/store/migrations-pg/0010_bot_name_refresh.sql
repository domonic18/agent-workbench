-- ============================================================ 0010 bot 名手动刷新请求
-- machine.bot_refresh_requested_at 记录控制台发起的「刷新 bot 名」请求时刻。
-- /api/aw-node/config 拉取时若该值非空,响应携带 refresh_bot_names 并清空标记,
-- aw-node 据此清空本机 bot 名缓存并立即重取上报。消费即完成,不重试补偿。

ALTER TABLE machine
  ADD COLUMN bot_refresh_requested_at BIGINT;
