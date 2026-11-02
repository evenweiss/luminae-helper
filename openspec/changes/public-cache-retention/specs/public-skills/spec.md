## ADDED Requirements

### Requirement: 限量保留与并发安全
系统 SHALL 保留当前成功获取的正式版本，清理无读者的历史快照和临时数据。系统 SHALL 在刷新及缓存确认前原子登记占用，在整个安装流程 finally 中释放。并发读者 SHALL 不被清理中断。清理 SHALL 不回退 current 指针，不删除本地修改和不属于缓存的文件。

#### Scenario: 并发安装旧版
- WHEN 新版刷新完成但旧版仍有读者
- THEN 保留旧版直到最后一个读者释放，最终仅剩当前版本。

### Requirement: 异常回收
系统 SHALL 回收已退出进程的锁、租约和临时目录；不能确认进程已退出时 SHALL 保留。正常、取消和失败路径 SHALL 尝试清理。

#### Scenario: 安装进程崩溃
- WHEN 安装进程已退出且另一个操作进入缓存
- THEN 该进程的旧快照占用不再阻止回收，活跃进程的快照仍保留。
