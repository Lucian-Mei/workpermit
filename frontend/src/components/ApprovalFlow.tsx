import React from 'react';
import dayjs from 'dayjs';
import { Card, CardContent } from '@/components/ui';
import { Section } from '@/components/kit';
import { WORK_PERMIT_STATUS, WORK_PERMIT_APPLICATION_STATUS } from '@/constants';
import { ShieldCheck } from 'lucide-react';

type Channel = 'permit' | 'application';

interface Props {
  channel: Channel;
  isHazardous: boolean;
  status: string;
  data?: any;
}

// 审批进度树（状态机可视化）。危险作业票多一环「待EHS批准」。
export default function ApprovalFlow({ channel, isHazardous, status, data }: Props) {
  const map = channel === 'permit' ? WORK_PERMIT_STATUS : WORK_PERMIT_APPLICATION_STATUS;
  const firstReviewerRole = channel === 'permit' ? '申请部门主管' : '区域部门审核人';

  // 线性节点路径（暂停/作废单独处理）
  const path: string[] =
    channel === 'permit'
      ? isHazardous
        ? ['draft', 'pending_review', 'ehs_reviewing', 'reviewing', 'approved', 'printed', 'finished', 'completed']
        : ['draft', 'pending_review', 'approved', 'printed', 'finished', 'completed']
      : isHazardous
        ? ['draft', 'pending_review', 'reviewing', 'approved', 'printed', 'finished', 'completed']
        : ['draft', 'pending_review', 'approved', 'printed', 'finished', 'completed'];

  const roleOf: Record<string, string> = {
    pending_review: firstReviewerRole,
    ehs_reviewing: 'EHS工程师',
    reviewing: '工程部经理',
  };

  const infoOf: Record<string, { who?: string; when?: string; opinion?: string }> = {
    pending_review: { who: data?.reviewerName, when: data?.reviewedAt, opinion: data?.reviewOpinion },
    ehs_reviewing: { who: data?.ehsApproverName, when: data?.ehsApprovedAt, opinion: data?.ehsApprovalOpinion },
    reviewing: { who: data?.approverName, when: data?.approvedAt, opinion: data?.approvalOpinion },
  };

  // 计算当前位置
  let currentPos = path.indexOf(status);
  let rejected = false;
  let banner: { tone: 'destructive' | 'warning'; text: string } | null = null;

  if (status === 'rejected') {
    rejected = true;
    if (data?.ehsApprovedAt) currentPos = path.indexOf('reviewing');
    else if (data?.reviewedAt) currentPos = path.indexOf('ehs_reviewing') >= 0 ? path.indexOf('ehs_reviewing') : path.indexOf('reviewing');
    else currentPos = path.indexOf('pending_review');
  } else if (status === 'paused') {
    banner = { tone: 'warning', text: '作业已暂停' };
    currentPos = Math.max(0, path.indexOf('printed'));
  } else if (status === 'voided') {
    banner = { tone: 'destructive', text: '作业票已作废' };
    currentPos = 0;
  } else if (currentPos < 0) {
    currentPos = 0;
  }

  return (
    <Section title="审批进度" icon={<ShieldCheck size={16} />}>
      <Card>
        <CardContent>
          {banner && (
            <div
              className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
                banner.tone === 'destructive'
                  ? 'border-destructive/30 bg-destructive/5 text-destructive'
                  : 'border-warning/30 bg-warning/10 text-warning'
              }`}
            >
              {banner.text}
            </div>
          )}

          <div>
            {path.map((key, i) => {
              const isDone = i < currentPos;
              const isCurrent = i === currentPos;
              const isRejected = rejected && i === currentPos;
              const st = map[key];
              const info = infoOf[key] || {};
              const color = isRejected ? '#ef4444' : isCurrent ? (st?.color || '#3b82f6') : isDone ? '#22c55e' : '#cbd5e1';
              return (
                <div key={key} className="flex gap-3">
                  <div className="flex flex-col items-center" style={{ width: 20 }}>
                    <span
                      className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ background: color }}
                    >
                      {isRejected ? '✕' : isDone ? '✓' : i + 1}
                    </span>
                    {i < path.length - 1 && (
                      <span
                        className="my-1 w-px flex-1 rounded"
                        style={{ background: i < currentPos ? '#22c55e' : '#e2e8f0', minHeight: 20 }}
                      />
                    )}
                  </div>
                  <div className="flex-1 pb-3">
                    <div
                      className="text-sm font-medium"
                      style={{ color: isCurrent || isDone || isRejected ? '#0f172a' : '#94a3b8' }}
                    >
                      {st?.label || key}
                      {roleOf[key] && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">（{roleOf[key]}）</span>
                      )}
                    </div>
                    {(info.who || info.when) && (
                      <div className="text-xs text-muted-foreground">
                        {info.who || '—'}
                        {info.when ? ` · ${dayjs(info.when).format('MM-DD HH:mm')}` : ''}
                      </div>
                    )}
                    {info.opinion && <div className="mt-0.5 text-xs text-foreground">意见：{info.opinion}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </Section>
  );
}
