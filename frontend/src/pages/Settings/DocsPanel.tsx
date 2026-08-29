import React from 'react';

/**
 * 帮助文档
 * 以独立玻璃拟态文档（public/help.html，原 ehs-help.html）嵌入，
 * 替换原 architecture / process / manual 三页 SVG 内容。
 * 文档自带侧边导航、明暗/强调色切换与内部滚动，iframe 隔离其主题作用域，不影响宿主应用。
 */
export default function DocsPanel() {
  return (
    <div className="page-fade">
      <iframe
        src="/help.html"
        title="EHS 隐患与作业管理系统 · 帮助文档"
        className="w-full rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
        style={{ height: 'calc(100vh - 210px)', minHeight: 640 }}
      />
    </div>
  );
}
