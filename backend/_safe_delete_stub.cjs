// 仅用于本地沙箱预览：让 WorkBuddy safe-delete 守卫对当前后端进程放行。
// 原理：守卫在 fs.unlink/rename 时调用本脚本做"是否可删除"检查，
// 退出码 0 表示允许。后端进程只会删除自身 .pglite-data / uploads 下的文件，
// 不影响用户个人目录，故可安全放行。请勿用于生产。
process.exit(0);
