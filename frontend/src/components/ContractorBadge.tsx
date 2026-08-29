/**
 * 承包商作业动态图标：循环切换 3 个工人形象
 *  1) 登高（梯上作业 + 锤）
 *  2) 接电线（插座 + 电缆 + 闪电火花）
 *  3) 动火作业（焊枪 + 焊花）
 * 每个场景显示约 3s，平滑交叉淡入淡出；焊接/接线火花闪烁。
 * 填充父容器（看板原图标盒 h-11 w-11 = 44×44），尺寸不变。
 */
export default function ContractorBadge() {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 48 48"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="承包商作业动态图标"
    >
      <style>{`
        .cb-a, .cb-b, .cb-c { animation: cbCycle 9s infinite; will-change: opacity; }
        .cb-b { animation-delay: -6s; }
        .cb-c { animation-delay: -3s; }
        .cb-spark { animation: cbTwinkle 1.1s infinite; }
        .cb-bob { animation: cbBob 2.6s ease-in-out infinite; }
        @keyframes cbCycle {
          0%, 25% { opacity: 1; }
          33.33%, 91.66% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes cbTwinkle {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        @keyframes cbBob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-1.2px); }
        }
      `}</style>

      {/* 场景 A：登高（梯上作业） */}
      <g className="cb-a">
        <g stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" fill="none">
          <line x1="15" y1="46" x2="19" y2="13" />
          <line x1="27" y1="46" x2="31" y2="13" />
          <line x1="16" y1="20" x2="29" y2="20" />
          <line x1="16" y1="24" x2="28" y2="24" />
          <line x1="16" y1="28" x2="29" y2="28" />
          <line x1="17" y1="35" x2="28" y2="35" />
        </g>
        <g className="cb-bob" stroke="#38bdf8" strokeWidth="2.4" strokeLinecap="round" fill="none">
          <circle cx="23" cy="15" r="3" fill="#38bdf8" stroke="none" />
          <line x1="23" y1="18" x2="23" y2="27" />
          <line x1="23" y1="20" x2="18" y2="13" />
          <line x1="23" y1="20" x2="28" y2="16" />
          <line x1="23" y1="27" x2="20" y2="32" />
          <line x1="23" y1="27" x2="26" y2="32" />
        </g>
        <g stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="13" x2="15" y2="10" />
          <line x1="14" y1="9" x2="17" y2="12" />
        </g>
      </g>

      {/* 场景 B：接电线 */}
      <g className="cb-b">
        <rect x="33" y="20" width="9" height="11" rx="2" fill="#1e293b" stroke="#94a3b8" strokeWidth="1.5" />
        <circle cx="36.5" cy="24" r="1" fill="#cbd5e1" />
        <circle cx="36.5" cy="28" r="1" fill="#cbd5e1" />
        <path d="M27,23 q6,-2 6,1" stroke="#fbbf24" strokeWidth="2" fill="none" strokeLinecap="round" />
        <g className="cb-bob" stroke="#38bdf8" strokeWidth="2.4" strokeLinecap="round" fill="none">
          <circle cx="16" cy="16" r="3" fill="#38bdf8" stroke="none" />
          <line x1="16" y1="19" x2="16" y2="30" />
          <line x1="16" y1="21" x2="27" y2="23" />
          <line x1="16" y1="21" x2="11" y2="26" />
          <line x1="16" y1="30" x2="13" y2="38" />
          <line x1="16" y1="30" x2="20" y2="38" />
        </g>
        <path className="cb-spark" d="M40,19 l-3,4 l2,0 l-3,5" stroke="#fde047" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
      </g>

      {/* 场景 C：动火作业（焊接） */}
      <g className="cb-c">
        <g className="cb-bob" stroke="#38bdf8" strokeWidth="2.4" strokeLinecap="round" fill="none">
          <circle cx="18" cy="15" r="3.2" fill="#0f172a" stroke="#38bdf8" strokeWidth="1.5" />
          <line x1="18" y1="18" x2="18" y2="29" />
          <line x1="18" y1="21" x2="29" y2="26" />
          <line x1="18" y1="21" x2="13" y2="26" />
          <line x1="18" y1="29" x2="15" y2="38" />
          <line x1="18" y1="29" x2="22" y2="38" />
        </g>
        <line x1="29" y1="26" x2="33" y2="31" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
        <g className="cb-spark" stroke="#fb923c" strokeWidth="1.6" strokeLinecap="round">
          <line x1="33" y1="31" x2="37.5" y2="28" />
          <line x1="33" y1="31" x2="38.5" y2="32" />
          <line x1="33" y1="31" x2="36.5" y2="35" />
          <line x1="33" y1="31" x2="31" y2="36" />
        </g>
        <circle className="cb-spark" cx="33" cy="31" r="1.6" fill="#fde047" />
      </g>
    </svg>
  );
}
