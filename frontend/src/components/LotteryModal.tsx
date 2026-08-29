import React, { useEffect, useState } from 'react';
import api from '@/api/client';
import { Modal, Button, Spinner } from '@/components/ui';
import { Gift, Trophy, PartyPopper, Ticket, Inbox } from 'lucide-react';
import dayjs from 'dayjs';

interface LotteryResult {
  ok: boolean;
  prize?: string;
  reason?: string;
}

function prizeColor(prize?: string): string {
  if (!prize) return 'hsl(var(--muted-foreground))';
  if (prize.includes('一等奖')) return 'hsl(var(--primary))';
  if (prize.includes('二等奖')) return 'hsl(var(--info))';
  if (prize.includes('三等奖')) return 'hsl(var(--success))';
  return 'hsl(var(--muted-foreground))';
}

function DrawView({ result, hazardNo, onClose }: { result?: LotteryResult | null; hazardNo?: string; onClose: () => void }) {
  const won = !!result?.ok && !!result?.prize && result.prize !== '谢谢参与';
  const color = prizeColor(result?.prize);

  if (!result || !result.ok) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="icon-box" style={{ background: 'hsl(var(--muted) / .5)', color: 'hsl(var(--muted-foreground))' }}>
          <Ticket size={26} />
        </div>
        <div className="text-sm text-muted-foreground">
          {result?.reason === 'disabled' ? '抽奖活动暂未开启' : '本次未参与抽奖'}
        </div>
        <Button variant="secondary" onClick={onClose}>知道了</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div
        className="flex h-24 w-24 items-center justify-center rounded-full animate-pulse"
        style={{
          background: `color-mix(in srgb, ${color} 18%, hsl(var(--card)))`,
          border: `2px solid color-mix(in srgb, ${color} 45%, transparent)`,
          color,
          boxShadow: `0 0 36px -6px color-mix(in srgb, ${color} 55%, transparent)`,
        }}
      >
        {won ? <Trophy size={42} /> : <Gift size={42} />}
      </div>
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">抽奖结果</div>
        <div className="mt-1 text-2xl font-bold" style={{ color }}>{result.prize}</div>
      </div>
      {won ? (
        <div className="flex items-center gap-1.5 text-sm text-success">
          <PartyPopper size={16} /> 恭喜中奖，奖品将于活动结束后统一发放
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">感谢您为安全生产贡献力量，下次好运！</div>
      )}
      {hazardNo && (
        <div className="rounded-[var(--radius)] bg-card px-3 py-1.5 text-xs text-muted-foreground">
          关联隐患编号：<span className="font-mono text-foreground">{hazardNo}</span>
        </div>
      )}
      <Button onClick={onClose}>完成</Button>
    </div>
  );
}

function HistoryView({ loading, wins, onClose }: { loading: boolean; wins: any[]; onClose: () => void }) {
  if (loading) return <Spinner label="加载中奖记录…" />;
  if (!wins.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="icon-box" style={{ background: 'hsl(var(--muted) / .5)', color: 'hsl(var(--muted-foreground))' }}>
          <Inbox size={26} />
        </div>
        <div className="text-sm text-muted-foreground">暂无中奖记录，提交隐患即可参与抽奖</div>
        <Button variant="secondary" onClick={onClose}>知道了</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      <div className="text-xs text-muted-foreground">共 {wins.length} 次抽奖记录</div>
      {wins.map((w) => {
        const color = prizeColor(w.prize);
        const won = w.prize && w.prize !== '谢谢参与';
        return (
          <div key={w.id} className="card flex items-center gap-3 p-3" style={{ background: 'hsl(var(--card) / .6)' }}>
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
            >
              {won ? <Trophy size={18} /> : <Gift size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium" style={{ color }}>{w.prize}</div>
              <div className="truncate text-xs text-muted-foreground">
                {w.source === 'hazard' && w.refNo
                  ? `关联隐患 ${w.refNo}`
                  : w.source === 'hazard'
                    ? '提交隐患抽奖'
                    : w.source || '安全活动'}
              </div>
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              {dayjs(w.createdAt).format('YYYY-MM-DD HH:mm')}
            </div>
          </div>
        );
      })}
      <div className="flex justify-end pt-1">
        <Button variant="secondary" onClick={onClose}>关闭</Button>
      </div>
    </div>
  );
}

export default function LotteryModal({
  open,
  mode,
  result,
  hazardNo,
  onClose,
}: {
  open: boolean;
  mode: 'draw' | 'history';
  result?: LotteryResult | null;
  hazardNo?: string;
  onClose: () => void;
}) {
  const [wins, setWins] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && mode === 'history') {
      setLoading(true);
      api
        .get('/lottery/my')
        .then(({ data }) => setWins(Array.isArray(data) ? data : []))
        .catch(() => setWins([]))
        .finally(() => setLoading(false));
    }
  }, [open, mode]);

  return (
    <Modal
      open={open}
      title={mode === 'draw' ? '🎉 隐患上报抽奖' : '我的中奖记录'}
      onClose={onClose}
      size="md"
    >
      {mode === 'draw' ? (
        <DrawView result={result} hazardNo={hazardNo} onClose={onClose} />
      ) : (
        <HistoryView loading={loading} wins={wins} onClose={onClose} />
      )}
    </Modal>
  );
}
