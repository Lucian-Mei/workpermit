#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
p = os.path.join('src', 'pages', 'EOnsite', 'Inspections.tsx')
with open(p, encoding='utf-8') as f:
    s = f.read()

if 'useNavigate' not in s:
    s = s.replace(
        'import { useEffect, useState } from "react";',
        'import { useEffect, useState } from "react";\nimport { useNavigate } from "react-router-dom";'
    )

if 'const navigate = useNavigate();' not in s:
    s = s.replace(
        "  const [items, setItems] = useState<any[]>([]);",
        "  const navigate = useNavigate();\n  const [items, setItems] = useState<any[]>([]);"
    )

old = """            {items.map((it) => (
              <div key={it.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                    {it.permitNo || it.applicationId} · {it.inspector}
                  </div>
                  <span className="text-xs" style={{ color: it.result === 'abnormal' ? 'var(--destructive)' : 'var(--success)' }}>
                    {it.result === 'abnormal' ? '异常' : '正常'}
                  </span>
                </div>
                {it.note && <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{it.note}</div>}
                <div className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>{dayjs(it.inspectedAt).format('YYYY-MM-DD HH:mm')}</div>}
              </div>
            ))}"""
new = """            {items.map((it) => {
              const detailTo = it.workPermitId ? `/e-permits/view/${it.workPermitId}` : (it.applicationId ? `/e-applications/${it.applicationId}` : null);
              return (
                <div
                  key={it.id}
                  onClick={() => detailTo && navigate(detailTo)}
                  className={`rounded-lg border p-3 transition-colors ${detailTo ? 'cursor-pointer hover:bg-white/5' : ''}`}
                  style={{ borderColor: 'var(--border)' }}
                  title={detailTo ? '点击查看对应作业票详情' : ''}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <ClipboardCheck size={14} style={{ color: it.result === 'abnormal' ? 'var(--destructive)' : 'var(--success)' }} />
                      <span className="font-mono text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                        {it.permitNo || it.applicationId}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>· {it.inspector}</span>
                      {it.department && <span className="hidden truncate text-xs sm:inline" style={{ color: 'var(--muted-foreground)' }}>· {it.department}</span>}
                    </div>
                    <span className="shrink-0 text-xs" style={{ color: it.result === 'abnormal' ? 'var(--destructive)' : 'var(--success)' }}>
                      {it.result === 'abnormal' ? '异常' : '正常'}
                    </span>
                  </div>
                  {it.jobName && <div className="mt-1 truncate text-xs" style={{ color: 'var(--foreground)' }}>{it.jobName}</div>}
                  {(it.area || it.location) && (
                    <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      {[it.area, it.location].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {it.contractorUnit && (
                    <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--muted-foreground)' }}>承包商：{it.contractorUnit}</div>
                  )}
                  <div className="mt-1.5 flex items-center justify-between text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    <span>{dayjs(it.inspectedAt).format('YYYY-MM-DD HH:mm')}</span>
                    {detailTo && <span className="font-medium" style={{ color: 'var(--primary)' }}>查看详情 →</span>}
                  </div>
                  {it.note && <div className="mt-1 truncate text-xs" style={{ color: 'var(--muted-foreground)' }}>备注：{it.note}</div>}
                </div>
              );
            })}"""

if old in s:
    s = s.replace(old, new)
    print('list card patched')
else:
    print('OLD NOT FOUND')

with open(p, 'w', encoding='utf-8') as f:
    f.write(s)
print('done')
