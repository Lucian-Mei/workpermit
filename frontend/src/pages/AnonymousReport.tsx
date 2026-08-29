import React from 'react';
import HazardReport from '@/pages/Hazards/Report';

// 微信扫码免登录上报：界面与「上报隐患」完全一致（楼栋/楼层/区域、整改建议、照片、AI 分析、抽奖全保留），
// 仅不强制记录登录填报人员——不填提报人姓名即匿名上报（附算术验证码防批量、IP 限流）。
export default function AnonymousReport() {
  return <HazardReport anonymous />;
}
