import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DRIZZLE } from '@/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, count, inArray } from 'drizzle-orm';
import * as schema from '@/database/schema';
import { AuthService } from '@/modules/auth/auth.service';
import { PERMISSIONS, ROLE_SEEDS, PERMIT_NO_PREFIX } from '@/common/constants/domain';
import { evaluateRiskLevel } from '@/modules/work-permits/approval-routing';
import { appBaseUrl } from '@/common/base-url';

// 安全交底要点模板（原 work-permit-applications/briefing-template 已随模块删除，这里内联一份默认模板）
function buildBriefingTemplate() {
  return [
    {
      key: 'general',
      title: '作业前安全交底',
      mode: 'normal',
      items: [
        { text: '作业内容、范围与风险已告知全体作业人员' },
        { text: '作业票安全措施已逐项确认并落实' },
        { text: '个人防护用品已正确佩戴' },
        { text: '应急处置与疏散路线已明确' },
        { text: '监护人/监护措施已就位' },
      ],
    },
  ];
}

const DEMO_SEEDED = 'demo_seeded';
const DEMO_IDS = 'demo_ids';
const DEMO_PWD = 'Demo@123456';

// ============ 演示数据（模拟测试用，可重复/重置）============
const DEPARTMENTS = [
  { name: '生产部', abbreviation: 'PROD', responsiblePerson: '王刚', coordinator: '赵敏', coordinatorPhone: '13800000021' },
  { name: '设备动力部', abbreviation: 'MECH', responsiblePerson: '李伟', coordinator: '吴军', coordinatorPhone: '13800000031' },
  { name: '仓储物流部', abbreviation: 'WH', responsiblePerson: '薛梅', coordinator: '何星', coordinatorPhone: '13800000041' },
  { name: '安全环保部', abbreviation: 'EHS', responsiblePerson: '刘洋', coordinator: '陈静', coordinatorPhone: '13800000011' },
  { name: '质量管理部', abbreviation: 'QA', responsiblePerson: '杨帆', coordinator: '李娜', coordinatorPhone: '13800000051' },
  { name: '行政管理部', abbreviation: 'ADM', responsiblePerson: '郭华', coordinator: '董磊', coordinatorPhone: '13800000061' },
  { name: '研发部', abbreviation: 'RD', responsiblePerson: '周明', coordinator: '许丹', coordinatorPhone: '13800000071' },
  { name: '试剂生产部', abbreviation: 'RPD', responsiblePerson: '范斌', coordinator: '石磊', coordinatorPhone: '13800000081' },
  { name: '仪器生产部', abbreviation: 'IPD', responsiblePerson: '彭飞', coordinator: '蒋琳', coordinatorPhone: '13800000091' },
  { name: '工程部', abbreviation: 'ED', responsiblePerson: '尹航', coordinator: '易阳', coordinatorPhone: '13800000101' },
  { name: '采购部', abbreviation: 'PU', responsiblePerson: '葛军', coordinator: '段勇', coordinatorPhone: '13800000111' },
  { name: '财务部', abbreviation: 'FIN', responsiblePerson: '阮静', coordinator: '游丽', coordinatorPhone: '13800000121' },
];

// 真实区域（来源：区域信息.xlsx）
// name = 建筑 + 楼层 + 区域（保证唯一、下拉自解释）；code = 区域ID（作业票编号可追溯）
const AREAS = [
  { name: '综合楼 一楼 会议区', code: 'ZH-1001', building: '综合楼', floor: '一楼', responsibleDept: 'Admin 行政部', description: '综合楼 一楼', sortOrder: 1 },
  { name: '综合楼 一楼 前台', code: 'ZH-1002', building: '综合楼', floor: '一楼', responsibleDept: 'Admin 行政部', description: '综合楼 一楼', sortOrder: 2 },
  { name: '综合楼 一楼 餐厅', code: 'ZH-1003', building: '综合楼', floor: '一楼', responsibleDept: 'Admin 行政部', description: '综合楼 一楼', sortOrder: 3 },
  { name: '综合楼 二楼 北区', code: 'ZH-2001', building: '综合楼', floor: '二楼', responsibleDept: 'Admin 行政部', description: '综合楼 二楼', sortOrder: 4 },
  { name: '综合楼 二楼 大办公区', code: 'ZH-2002', building: '综合楼', floor: '二楼', responsibleDept: 'Admin 行政部', description: '综合楼 二楼', sortOrder: 5 },
  { name: '综合楼 二楼 南区', code: 'ZH-2003', building: '综合楼', floor: '二楼', responsibleDept: 'Admin 行政部', description: '综合楼 二楼', sortOrder: 6 },
  { name: '综合楼 三楼 研发办公区', code: 'ZH-3001', building: '综合楼', floor: '三楼', responsibleDept: 'RRD 试剂研发部', description: '综合楼 三楼', sortOrder: 7 },
  { name: '外围 门卫室', code: 'WW-1001', building: '外围', floor: '外围', responsibleDept: 'EHS 安全管理部', description: '外围', sortOrder: 8 },
  { name: '分子楼 一楼 常温库', code: 'FZ-1001', building: '分子楼', floor: '一楼', responsibleDept: 'RWH-MDx 分子仓库', description: '分子楼 一楼', sortOrder: 9 },
  { name: '分子楼 二楼 Tulip办公区', code: 'FZ-2001', building: '分子楼', floor: '二楼', responsibleDept: 'Tulip 托力普', description: '分子楼 二楼', sortOrder: 10 },
  { name: '分子楼 三楼 办公区', code: 'FZ-3001', building: '分子楼', floor: '三楼', responsibleDept: 'RPD-MDx 分子生产部', description: '分子楼 三楼', sortOrder: 11 },
  { name: '分子楼 楼梯 南楼梯', code: 'FZ-4002', building: '分子楼', floor: '楼梯', responsibleDept: 'ED 工程部', description: '分子楼 楼梯', sortOrder: 12 },
  { name: '分子楼 楼顶 楼顶', code: 'FZ-4003', building: '分子楼', floor: '楼顶', responsibleDept: 'ED 工程部', description: '分子楼 楼顶', sortOrder: 13 },
  { name: '仪器楼 一楼 办公室', code: 'YQ-1001', building: '仪器楼', floor: '一楼', responsibleDept: 'IWH 仪器仓库', description: '仪器楼 一楼', sortOrder: 14 },
  { name: '仪器楼 二楼 分子QC实验室', code: 'YQ-2001', building: '仪器楼', floor: '二楼', responsibleDept: 'RQC 试剂质量控制部', description: '仪器楼 二楼', sortOrder: 15 },
  { name: '仪器楼 三楼 仪器生产区', code: 'YQ-3001', building: '仪器楼', floor: '三楼', responsibleDept: 'IPD 仪器生产部', description: '仪器楼 三楼', sortOrder: 16 },
  { name: '仪器楼 楼梯 北楼梯', code: 'YQ-4001', building: '仪器楼', floor: '楼梯', responsibleDept: 'ED 工程部', description: '仪器楼 楼梯', sortOrder: 17 },
  { name: '仪器楼 楼顶 楼顶', code: 'YQ-4003', building: '仪器楼', floor: '楼顶', responsibleDept: 'ED 工程部', description: '仪器楼 楼顶', sortOrder: 18 },
  { name: '试剂楼 一楼 常温库', code: 'SJ-1001', building: '试剂楼', floor: '一楼', responsibleDept: 'RWH-IDx 免疫仓库', description: '试剂楼 一楼', sortOrder: 19 },
  { name: '试剂楼 二楼 试剂实验室', code: 'SJ-2001', building: '试剂楼', floor: '二楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 二楼', sortOrder: 20 },
  { name: '试剂楼 二楼 ICL仓库', code: 'SJ-2007', building: '试剂楼', floor: '二楼', responsibleDept: 'ICL 瑞孚迪实验室', description: '试剂楼 二楼', sortOrder: 21 },
  { name: '试剂楼 楼梯 货梯', code: 'SJ-4001', building: '试剂楼', floor: '楼梯', responsibleDept: 'ED 工程部', description: '试剂楼 楼梯', sortOrder: 22 },
  { name: '试剂楼 楼顶 楼顶', code: 'SJ-4005', building: '试剂楼', floor: '楼顶', responsibleDept: 'ED 工程部', description: '试剂楼 楼顶', sortOrder: 23 },
  { name: '综合楼 一楼 走廊', code: 'ZH-1004', building: '综合楼', floor: '一楼', responsibleDept: 'Admin 行政部', description: '综合楼 一楼', sortOrder: 24 },
  { name: '综合楼 三楼 仪器研发区', code: 'ZH-3002', building: '综合楼', floor: '三楼', responsibleDept: 'IRD 仪器研发部', description: '综合楼 三楼', sortOrder: 25 },
  { name: '综合楼 三楼 试剂研发区', code: 'ZH-3003', building: '综合楼', floor: '三楼', responsibleDept: 'RRD 试剂研发部', description: '综合楼 三楼', sortOrder: 26 },
  { name: '试剂楼 一楼 冷库', code: 'SJ-1002', building: '试剂楼', floor: '一楼', responsibleDept: 'RWH-IDx 免疫仓库', description: '试剂楼 一楼', sortOrder: 27 },
  { name: '试剂楼 一楼 包装区', code: 'SJ-1003', building: '试剂楼', floor: '一楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 一楼', sortOrder: 28 },
  { name: '试剂楼 一楼 一般区', code: 'SJ-1005', building: '试剂楼', floor: '一楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 一楼', sortOrder: 29 },
  { name: '综合楼 三楼 走廊', code: 'ZH-3004', building: '综合楼', floor: '三楼', responsibleDept: 'RRD 试剂研发部', description: '综合楼 三楼', sortOrder: 30 },
  { name: '综合楼 三楼 其他', code: 'ZH-3005', building: '综合楼', floor: '三楼', responsibleDept: 'ED 工程部', description: '综合楼 三楼', sortOrder: 31 },
  { name: '试剂楼 一楼 办公区', code: 'SJ-1004', building: '试剂楼', floor: '一楼', responsibleDept: 'RWH-IDx 免疫仓库', description: '试剂楼 一楼', sortOrder: 32 },
  { name: '试剂楼 一楼 其他', code: 'SJ-1006', building: '试剂楼', floor: '一楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 一楼', sortOrder: 33 },
  { name: '试剂楼 二楼 微生物实验室', code: 'SJ-2002', building: '试剂楼', floor: '二楼', responsibleDept: 'RQC 试剂质量控制部', description: '试剂楼 二楼', sortOrder: 34 },
  { name: '试剂楼 二楼 PCR实验室', code: 'SJ-2003', building: '试剂楼', floor: '二楼', responsibleDept: 'RRD-MDx 分子研发部', description: '试剂楼 二楼', sortOrder: 35 },
  { name: '试剂楼 二楼 绿区3', code: 'SJ-2004', building: '试剂楼', floor: '二楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 二楼', sortOrder: 36 },
  { name: '试剂楼 二楼 ICL实验室', code: 'SJ-2005', building: '试剂楼', floor: '二楼', responsibleDept: 'ICL 瑞孚迪实验室', description: '试剂楼 二楼', sortOrder: 37 },
  { name: '试剂楼 二楼 ICL办公区', code: 'SJ-2006', building: '试剂楼', floor: '二楼', responsibleDept: 'ICL 瑞孚迪实验室', description: '试剂楼 二楼', sortOrder: 38 },
  { name: '试剂楼 二楼 其他', code: 'SJ-2008', building: '试剂楼', floor: '二楼', responsibleDept: 'ED 工程部', description: '试剂楼 二楼', sortOrder: 39 },
  { name: '试剂楼 三楼 办公室', code: 'SJ-3001', building: '试剂楼', floor: '三楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 三楼', sortOrder: 40 },
  { name: '试剂楼 三楼 绿区1', code: 'SJ-3002', building: '试剂楼', floor: '三楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 三楼', sortOrder: 41 },
  { name: '试剂楼 三楼 绿区2', code: 'SJ-3003', building: '试剂楼', floor: '三楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 三楼', sortOrder: 42 },
  { name: '试剂楼 三楼 红区实验室', code: 'SJ-3004', building: '试剂楼', floor: '三楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 三楼', sortOrder: 43 },
  { name: '试剂楼 三楼 万级红区', code: 'SJ-3005', building: '试剂楼', floor: '三楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 三楼', sortOrder: 44 },
  { name: '试剂楼 三楼 理化实验室', code: 'SJ-3006', building: '试剂楼', floor: '三楼', responsibleDept: 'RQC 试剂质量控制部', description: '试剂楼 三楼', sortOrder: 45 },
  { name: '试剂楼 三楼 空调机房', code: 'SJ-3007', building: '试剂楼', floor: '三楼', responsibleDept: 'ED 工程部', description: '试剂楼 三楼', sortOrder: 46 },
  { name: '试剂楼 三楼 冻干机房', code: 'SJ-3009', building: '试剂楼', floor: '三楼', responsibleDept: 'ED 工程部', description: '试剂楼 三楼', sortOrder: 47 },
  { name: '试剂楼 三楼 其他', code: 'SJ-3010', building: '试剂楼', floor: '三楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 三楼', sortOrder: 48 },
  { name: '分子楼 一楼 冷库', code: 'FZ-1002', building: '分子楼', floor: '一楼', responsibleDept: 'ED 工程部', description: '分子楼 一楼', sortOrder: 49 },
  { name: '分子楼 一楼 取样间', code: 'FZ-1003', building: '分子楼', floor: '一楼', responsibleDept: 'RQC 试剂质量控制部', description: '分子楼 一楼', sortOrder: 50 },
  { name: '分子楼 一楼 办公室', code: 'FZ-1004', building: '分子楼', floor: '一楼', responsibleDept: 'ED 工程部', description: '分子楼 一楼', sortOrder: 51 },
  { name: '分子楼 一楼 更衣换鞋区', code: 'FZ-1005', building: '分子楼', floor: '一楼', responsibleDept: 'RPD-MDx 分子生产部', description: '分子楼 一楼', sortOrder: 52 },
  { name: '分子楼 一楼 仪器生产区', code: 'FZ-1006', building: '分子楼', floor: '一楼', responsibleDept: 'IPD 仪器生产部', description: '分子楼 一楼', sortOrder: 53 },
  { name: '分子楼 一楼 其他', code: 'FZ-1007', building: '分子楼', floor: '一楼', responsibleDept: 'RPD-MDx 分子生产部', description: '分子楼 一楼', sortOrder: 54 },
  { name: '分子楼 二楼 Tulip生产区', code: 'FZ-2002', building: '分子楼', floor: '二楼', responsibleDept: 'Tulip 托力普', description: '分子楼 二楼', sortOrder: 55 },
  { name: '分子楼 二楼 其他', code: 'FZ-2003', building: '分子楼', floor: '二楼', responsibleDept: 'Tulip 托力普', description: '分子楼 二楼', sortOrder: 56 },
  { name: '分子楼 三楼 一般生产区', code: 'FZ-3002', building: '分子楼', floor: '三楼', responsibleDept: 'RPD-MDx 分子生产部', description: '分子楼 三楼', sortOrder: 57 },
  { name: '分子楼 三楼 D级区', code: 'FZ-3003', building: '分子楼', floor: '三楼', responsibleDept: 'RPD-MDx 分子生产部', description: '分子楼 三楼', sortOrder: 58 },
  { name: '分子楼 三楼 C级阴性区', code: 'FZ-3004', building: '分子楼', floor: '三楼', responsibleDept: 'RPD-MDx 分子生产部', description: '分子楼 三楼', sortOrder: 59 },
  { name: '分子楼 三楼 C级阳性区', code: 'FZ-3005', building: '分子楼', floor: '三楼', responsibleDept: 'RPD-MDx 分子生产部', description: '分子楼 三楼', sortOrder: 60 },
  { name: '分子楼 一楼 维修间', code: 'FZ-1008', building: '分子楼', floor: '一楼', responsibleDept: 'ED 工程部', description: '分子楼 一楼', sortOrder: 61 },
  { name: '分子楼 二楼 清洗间', code: 'FZ-2004', building: '分子楼', floor: '二楼', responsibleDept: 'Tulip 托力普', description: '分子楼 二楼', sortOrder: 62 },
  { name: '试剂楼 一楼 危化品库', code: 'SJ-1007', building: '试剂楼', floor: '一楼', responsibleDept: 'RWH-IDx 免疫仓库', description: '试剂楼 一楼', sortOrder: 63 },
  { name: '试剂楼 一楼 危废库', code: 'SJ-1008', building: '试剂楼', floor: '一楼', responsibleDept: 'EHS 安全管理部', description: '试剂楼 一楼', sortOrder: 64 },
  { name: '试剂楼 一楼 缓冲间', code: 'SJ-1009', building: '试剂楼', floor: '一楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 一楼', sortOrder: 65 },
  { name: '试剂楼 二楼 称量间', code: 'SJ-2009', building: '试剂楼', floor: '二楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 二楼', sortOrder: 66 },
  { name: '试剂楼 三楼 培养间', code: 'SJ-3008', building: '试剂楼', floor: '三楼', responsibleDept: 'RPD-IDx 免疫生产部', description: '试剂楼 三楼', sortOrder: 67 },
  { name: '仪器楼 一楼 危化品库', code: 'YQ-1002', building: '仪器楼', floor: '一楼', responsibleDept: 'IWH 仪器仓库', description: '仪器楼 一楼', sortOrder: 68 },
  { name: '仪器楼 三楼 纯化间', code: 'YQ-3002', building: '仪器楼', floor: '三楼', responsibleDept: 'IPD 仪器生产部', description: '仪器楼 三楼', sortOrder: 69 },
  { name: '综合楼 一楼 消防控制室', code: 'ZH-1005', building: '综合楼', floor: '一楼', responsibleDept: 'EHS 安全管理部', description: '综合楼 一楼', sortOrder: 70 },
  { name: '综合楼 二楼 会议室', code: 'ZH-2004', building: '综合楼', floor: '二楼', responsibleDept: 'Admin 行政部', description: '综合楼 二楼', sortOrder: 71 },
  { name: '综合楼 三楼 档案室', code: 'ZH-3006', building: '综合楼', floor: '三楼', responsibleDept: 'Admin 行政部', description: '综合楼 三楼', sortOrder: 72 },
  { name: '外围 消防泵房', code: 'WW-1002', building: '外围', floor: '外围', responsibleDept: 'ED 工程部', description: '外围', sortOrder: 73 },
  { name: '外围 危化品库', code: 'WW-1003', building: '外围', floor: '外围', responsibleDept: 'EHS 安全管理部', description: '外围', sortOrder: 74 },
];

// 旧演示区域名 → 新真实区域名（区域管理已替换，演示数据引用需同步）
const AREA_ALIAS: Record<string, string> = {
  '一号生产厂房': '试剂楼 一楼 包装区',
  '二号生产厂房': '试剂楼 二楼 绿区3',
  '原料仓库': '试剂楼 一楼 常温库',
  '成品仓库': '分子楼 一楼 常温库',
  '配电室': '试剂楼 三楼 空调机房',
  '锅炉房': '试剂楼 三楼 冻干机房',
  '综合办公楼': '综合楼 二楼 大办公区',
  '厂区物流通道': '外围 门卫室',
};
function mapArea(n?: string): string {
  if (!n) return '';
  return AREA_ALIAS[n] ?? n;
}

// 演示账号（不含已有的 admin）。username=登录名，roleKey 决定权限。
const USERS = [
  { username: 'liuyang', name: '刘洋', department: '安全环保部', area: '综合办公楼', roleKey: 'safety', email: 'liuyang@ehs-demo.com', phone: '13700000011' },
  { username: 'chenjing', name: '陈静', department: '安全环保部', area: '综合办公楼', roleKey: 'safety', email: 'chenjing@ehs-demo.com', phone: '13700000012' },
  { username: 'wanggang', name: '王刚', department: '生产部', area: '一号生产厂房', roleKey: 'approver', email: 'wanggang@ehs-demo.com', phone: '13700000021' },
  { username: 'zhaomin', name: '赵敏', department: '生产部', area: '一号生产厂房', roleKey: 'employee', email: 'zhaomin@ehs-demo.com', phone: '13700000022' },
  { username: 'sunli', name: '孙丽', department: '生产部', area: '二号生产厂房', roleKey: 'employee', email: 'sunli@ehs-demo.com', phone: '13700000023' },
  { username: 'zhouqiang', name: '周强', department: '生产部', area: '二号生产厂房', roleKey: 'employee', email: 'zhouqiang@ehs-demo.com', phone: '13700000024' },
  { username: 'liwei', name: '李伟', department: '设备动力部', area: '配电室', roleKey: 'approver', email: 'liwei@ehs-demo.com', phone: '13700000031' },
  { username: 'wujun', name: '吴军', department: '设备动力部', area: '配电室', roleKey: 'employee', email: 'wujun@ehs-demo.com', phone: '13700000032' },
  { username: 'zhengtao', name: '郑涛', department: '设备动力部', area: '锅炉房', roleKey: 'employee', email: 'zhengtao@ehs-demo.com', phone: '13700000033' },
  { username: 'xuemei', name: '薛梅', department: '仓储物流部', area: '原料仓库', roleKey: 'approver', email: 'xuemei@ehs-demo.com', phone: '13700000041' },
  { username: 'hexing', name: '何星', department: '仓储物流部', area: '成品仓库', roleKey: 'employee', email: 'hexing@ehs-demo.com', phone: '13700000042' },
  { username: 'yangfan', name: '杨帆', department: '质量管理部', area: '综合办公楼', roleKey: 'approver', email: 'yangfan@ehs-demo.com', phone: '13700000051' },
  { username: 'lina', name: '李娜', department: '质量管理部', area: '综合办公楼', roleKey: 'employee', email: 'lina@ehs-demo.com', phone: '13700000052' },
  { username: 'guohua', name: '郭华', department: '行政管理部', area: '综合办公楼', roleKey: 'approver', email: 'guohua@ehs-demo.com', phone: '13700000061' },
  { username: 'donglei', name: '董磊', department: '行政管理部', area: '厂区物流通道', roleKey: 'employee', email: 'donglei@ehs-demo.com', phone: '13700000062' },
  { username: 'admin2', name: '系统运维', department: '安全环保部', area: '综合办公楼', roleKey: 'admin', email: 'admin2@ehs-demo.com', phone: '13700000009' },
];

// 模拟员工数据（普通员工/安全员/审批人，按部门分布，演示“部门/员工”管理页）
const EMPLOYEES: { username: string; name: string; department: string; area: string; roleKey: string; email: string; phone: string }[] = [
  // 生产部
  { username: 'sc01', name: '孙强', department: '生产部', area: '试剂楼 一楼 包装区', roleKey: 'approver', email: 'sc01@ehs-demo.com', phone: '13700000131' },
  { username: 'sc02', name: '李娟', department: '生产部', area: '试剂楼 一楼 包装区', roleKey: 'employee', email: 'sc02@ehs-demo.com', phone: '13700000132' },
  { username: 'sc03', name: '马涛', department: '生产部', area: '试剂楼 一楼 一般区', roleKey: 'employee', email: 'sc03@ehs-demo.com', phone: '13700000133' },
  // 设备动力部
  { username: 'sb01', name: '吴磊', department: '设备动力部', area: '试剂楼 三楼 空调机房', roleKey: 'approver', email: 'sb01@ehs-demo.com', phone: '13700000141' },
  { username: 'sb02', name: '郑凯', department: '设备动力部', area: '试剂楼 三楼 冻干机房', roleKey: 'employee', email: 'sb02@ehs-demo.com', phone: '13700000142' },
  { username: 'sb03', name: '冯静', department: '设备动力部', area: '试剂楼 三楼 空调机房', roleKey: 'employee', email: 'sb03@ehs-demo.com', phone: '13700000143' },
  // 仓储物流部
  { username: 'wl01', name: '何勇', department: '仓储物流部', area: '试剂楼 一楼 常温库', roleKey: 'approver', email: 'wl01@ehs-demo.com', phone: '13700000151' },
  { username: 'wl02', name: '钱进', department: '仓储物流部', area: '试剂楼 一楼 冷库', roleKey: 'employee', email: 'wl02@ehs-demo.com', phone: '13700000152' },
  { username: 'wl03', name: '宋宇', department: '仓储物流部', area: '试剂楼 一楼 常温库', roleKey: 'employee', email: 'wl03@ehs-demo.com', phone: '13700000153' },
  // 安全环保部
  { username: 'eh01', name: '林涛', department: '安全环保部', area: '综合楼 一楼 会议区', roleKey: 'safety', email: 'eh01@ehs-demo.com', phone: '13700000161' },
  { username: 'eh02', name: '赵磊', department: '安全环保部', area: '综合楼 一楼 会议区', roleKey: 'safety', email: 'eh02@ehs-demo.com', phone: '13700000162' },
  { username: 'eh03', name: '孙倩', department: '安全环保部', area: '综合楼 三楼 仪器研发区', roleKey: 'employee', email: 'eh03@ehs-demo.com', phone: '13700000163' },
  // 质量管理部
  { username: 'qa01', name: '杨梅', department: '质量管理部', area: '仪器楼 二楼 分子QC实验室', roleKey: 'approver', email: 'qa01@ehs-demo.com', phone: '13700000171' },
  { username: 'qa02', name: '周敏', department: '质量管理部', area: '仪器楼 二楼 分子QC实验室', roleKey: 'employee', email: 'qa02@ehs-demo.com', phone: '13700000172' },
  { username: 'qa03', name: '吴迪', department: '质量管理部', area: '仪器楼 三楼 仪器生产区', roleKey: 'employee', email: 'qa03@ehs-demo.com', phone: '13700000173' },
  // 行政管理部
  { username: 'ad01', name: '高翔', department: '行政管理部', area: '综合楼 一楼 前台', roleKey: 'approver', email: 'ad01@ehs-demo.com', phone: '13700000181' },
  { username: 'ad02', name: '白露', department: '行政管理部', area: '综合楼 二楼 大办公区', roleKey: 'employee', email: 'ad02@ehs-demo.com', phone: '13700000182' },
  { username: 'ad03', name: '韩雪', department: '行政管理部', area: '综合楼 二楼 南区', roleKey: 'employee', email: 'ad03@ehs-demo.com', phone: '13700000183' },
  // 研发部
  { username: 'rd01', name: '周明', department: '研发部', area: '综合楼 三楼 试剂研发区', roleKey: 'approver', email: 'rd01@ehs-demo.com', phone: '13700000191' },
  { username: 'rd02', name: '许丹', department: '研发部', area: '综合楼 三楼 试剂研发区', roleKey: 'employee', email: 'rd02@ehs-demo.com', phone: '13700000192' },
  { username: 'rd03', name: '袁媛', department: '研发部', area: '综合楼 三楼 仪器研发区', roleKey: 'employee', email: 'rd03@ehs-demo.com', phone: '13700000193' },
  // 试剂生产部
  { username: 'rp01', name: '范斌', department: '试剂生产部', area: '试剂楼 二楼 绿区3', roleKey: 'approver', email: 'rp01@ehs-demo.com', phone: '13700000201' },
  { username: 'rp02', name: '石磊', department: '试剂生产部', area: '试剂楼 二楼 绿区3', roleKey: 'employee', email: 'rp02@ehs-demo.com', phone: '13700000202' },
  { username: 'rp03', name: '崔健', department: '试剂生产部', area: '试剂楼 二楼 ICL实验室', roleKey: 'employee', email: 'rp03@ehs-demo.com', phone: '13700000203' },
  // 仪器生产部
  { username: 'ip01', name: '彭飞', department: '仪器生产部', area: '仪器楼 三楼 仪器生产区', roleKey: 'approver', email: 'ip01@ehs-demo.com', phone: '13700000211' },
  { username: 'ip02', name: '蒋琳', department: '仪器生产部', area: '仪器楼 三楼 仪器生产区', roleKey: 'employee', email: 'ip02@ehs-demo.com', phone: '13700000212' },
  { username: 'ip03', name: '谭伟', department: '仪器生产部', area: '仪器楼 三楼 理化实验室', roleKey: 'employee', email: 'ip03@ehs-demo.com', phone: '13700000213' },
  // 工程部
  { username: 'en01', name: '尹航', department: '工程部', area: '分子楼 楼梯 南楼梯', roleKey: 'approver', email: 'en01@ehs-demo.com', phone: '13700000221' },
  { username: 'en02', name: '易阳', department: '工程部', area: '分子楼 楼顶 楼顶', roleKey: 'employee', email: 'en02@ehs-demo.com', phone: '13700000222' },
  { username: 'en03', name: '武琳', department: '工程部', area: '分子楼 一楼 其他', roleKey: 'employee', email: 'en03@ehs-demo.com', phone: '13700000223' },
  // 采购部
  { username: 'pu01', name: '葛军', department: '采购部', area: '综合楼 二楼 大办公区', roleKey: 'approver', email: 'pu01@ehs-demo.com', phone: '13700000231' },
  { username: 'pu02', name: '段勇', department: '采购部', area: '综合楼 二楼 大办公区', roleKey: 'employee', email: 'pu02@ehs-demo.com', phone: '13700000232' },
  { username: 'pu03', name: '洪波', department: '采购部', area: '综合楼 三楼 其他', roleKey: 'employee', email: 'pu03@ehs-demo.com', phone: '13700000233' },
  // 财务部
  { username: 'fi01', name: '阮静', department: '财务部', area: '综合楼 二楼 南区', roleKey: 'approver', email: 'fi01@ehs-demo.com', phone: '13700000241' },
  { username: 'fi02', name: '游丽', department: '财务部', area: '综合楼 二楼 南区', roleKey: 'employee', email: 'fi02@ehs-demo.com', phone: '13700000242' },
  { username: 'fi03', name: '鲍蕾', department: '财务部', area: '综合楼 三楼 其他', roleKey: 'employee', email: 'fi03@ehs-demo.com', phone: '13700000243' },
];

type HzSeed = {
  category: string; area: string; department: string; risk: 'normal' | 'major' | 'critical';
  status: string; submitter: string; assignee?: string; daysAgo: number;
  desc: string; suggest?: string; rectDesc?: string; acceptResult?: string; rejectReason?: string;
  building?: string; floor?: string; location?: string;
};

const HAZARDS: HzSeed[] = [
  { category: '消防安全', area: '一号生产厂房', department: '生产部', risk: 'major', status: 'pending_assign', submitter: 'zhaomin', daysAgo: 2, building: '一号厂房', floor: '一层', location: '北侧消防通道', desc: '车间北侧消防通道被物料托盘占用，有效宽度不足 1 米，违反疏散通道要求。', suggest: '立即清空消防通道，地面画线标识并纳入每日点检。' },
  { category: '用电安全', area: '配电室', department: '设备动力部', risk: 'critical', status: 'assigned', submitter: 'wujun', assignee: 'liwei', daysAgo: 5, building: '配电室', floor: '—', location: '1#配电柜', desc: '配电柜上方桥架线缆绝缘层老化龟裂，存在短路起火风险。', suggest: '更换破损线缆，加装线槽并做绝缘检测。', rectDesc: '已更换桥架线缆 12 米并复测绝缘合格。' },
  { category: '机械设备', area: '二号生产厂房', department: '生产部', risk: 'major', status: 'rectified', submitter: 'sunli', assignee: 'wanggang', daysAgo: 6, building: '二号厂房', floor: '二层', location: '冲压线', desc: '冲压设备急停按钮被周转箱遮挡，作业人员无法快速拍停。', suggest: '急停按钮加装防护罩并重新标识醒目位置。', rectDesc: '已加装透明防护罩并张贴红色标识。' },
  { category: '高处作业', area: '二号生产厂房', department: '生产部', risk: 'major', status: 'rectified', submitter: 'zhouqiang', assignee: 'wanggang', daysAgo: 9, building: '二号厂房', floor: '屋面', location: '检修平台', desc: '喷涂线检修平台护栏高度不足 1.05 米，临边作业有坠落风险。', suggest: '护栏加高至 1.2 米并增设踢脚板。', rectDesc: '护栏已加高至 1.2 米并增设踢脚板，附照片。' },
  { category: '危化品', area: '原料仓库', department: '仓储物流部', risk: 'critical', status: 'rectified', submitter: 'hexing', assignee: 'xuemei', daysAgo: 11, building: '原料库', floor: '—', location: '乙醇暂存区', desc: '乙醇暂存区未设置防泄漏围堰，地面无防静电措施。', suggest: '增设防泄漏收集槽，地面做防静电处理并张贴 MSDS。', rectDesc: '已安装不锈钢围堰，地面涂防静电漆。' },
  { category: '职业健康', area: '二号生产厂房', department: '生产部', risk: 'normal', status: 'accepted', submitter: 'sunli', assignee: 'wanggang', daysAgo: 14, desc: '喷涂岗位部分员工未规范佩戴防毒半面罩。', suggest: '配发新滤毒罐并组织 PPE 佩戴培训与考核。', rectDesc: '已配发新滤毒罐并组织 PPE 佩戴培训，抽查合格。', acceptResult: 'pass' },
  { category: '消防安全', area: '综合办公楼', department: '行政管理部', risk: 'normal', status: 'accepted', submitter: 'donglei', assignee: 'guohua', daysAgo: 16, desc: '办公楼楼道灭火器超期未点检。', suggest: '更换到期灭火器并落实月度点检卡。', rectDesc: '已更换 8 具灭火器并贴月度点检卡。', acceptResult: 'pass' },
  { category: '用电安全', area: '锅炉房', department: '设备动力部', risk: 'major', status: 'assigned', submitter: 'zhengtao', assignee: 'liwei', daysAgo: 3, building: '锅炉房', floor: '一层', location: '控制柜', desc: '锅炉房临时插座线路私拉，负荷过载发热。', suggest: '拆除临时线路，按规范重新布线并加装漏电保护。' },
  { category: '机械设备', area: '一号生产厂房', department: '生产部', risk: 'normal', status: 'pending_assign', submitter: 'zhaomin', daysAgo: 1, building: '一号厂房', floor: '一层', location: '传送带', desc: '传送带防护网松动，有卷入风险。', suggest: '紧固并加固防护网固定点。' },
  { category: '高处作业', area: '厂区物流通道', department: '行政管理部', risk: 'major', status: 'rejected', submitter: 'donglei', assignee: 'guohua', daysAgo: 8, building: '厂区道路', floor: '—', location: '路灯检修', desc: '路灯检修登高车支腿未完全展开即作业。', suggest: '支腿全展并铺垫钢板，设专人监护。', rectDesc: '已整改但未提供监护记录。', acceptResult: 'fail', rejectReason: '整改未附现场监护与验收照片，需补充后重新提交。' },
  { category: '危化品', area: '原料仓库', department: '仓储物流部', risk: 'major', status: 'accepted', submitter: 'hexing', assignee: 'xuemei', daysAgo: 13, building: '原料库', floor: '—', location: '通风机房', desc: '危化品库通风风机故障停用 2 天。', suggest: '修复风机并加装备用电源。', rectDesc: '风机已修复并测试正常运行。', acceptResult: 'pass' },
  { category: '消防安全', area: '成品仓库', department: '仓储物流部', risk: 'critical', status: 'assigned', submitter: 'hexing', assignee: 'xuemei', daysAgo: 4, building: '成品库', floor: '—', location: '货架区', desc: '成品仓库烟感探测器被货物遮挡，存在探测盲区。', suggest: '调整货位布局，确保探测器周围 0.5 米无遮挡。' },
  { category: '用电安全', area: '一号生产厂房', department: '生产部', risk: 'normal', status: 'accepted', submitter: 'zhaomin', assignee: 'wanggang', daysAgo: 18, building: '一号厂房', floor: '一层', location: '设备端子', desc: '设备接地端子松动，外壳带电隐患。', suggest: '重新压接并复测接地电阻。', rectDesc: '接地电阻 0.8Ω，合格。', acceptResult: 'pass' },
  { category: '机械设备', area: '配电室', department: '设备动力部', risk: 'major', status: 'rectified', submitter: 'wujun', assignee: 'liwei', daysAgo: 7, building: '配电室', floor: '—', location: '变压器室', desc: '变压器散热风扇异响、温控偏高。', suggest: '清洗散热器，更换轴承并监测温度。', rectDesc: '已更换轴承，运行温度恢复正常。' },
  { category: '高处作业', area: '一号生产厂房', department: '生产部', risk: 'critical', status: 'pending_assign', submitter: 'zhouqiang', daysAgo: 1, building: '一号厂房', floor: '屋面', location: '临边', desc: '屋面检修无生命线，临边作业无防坠措施。', suggest: '安装水平生命线并配置双钩安全带。' },
  { category: '职业健康', area: '原料仓库', department: '仓储物流部', risk: 'normal', status: 'accepted', submitter: 'hexing', assignee: 'xuemei', daysAgo: 20, building: '原料库', floor: '—', location: '库区', desc: '叉车尾气在密闭库区积聚。', suggest: '增设强制通风并限时作业。', rectDesc: '已装排风扇，CO 检测达标。', acceptResult: 'pass' },
  { category: '消防安全', area: '二号生产厂房', department: '生产部', risk: 'major', status: 'assigned', submitter: 'sunli', assignee: 'wanggang', daysAgo: 2, building: '二号厂房', floor: '一层', location: '通道口', desc: '二号厂房灭火器箱被设备阻挡，取用不便。', suggest: '迁移灭火器箱至通道口并标识。' },
  { category: '用电安全', area: '综合办公楼', department: '行政管理部', risk: 'normal', status: 'accepted', submitter: 'donglei', assignee: 'guohua', daysAgo: 22, building: '办公楼', floor: '二层', location: '会议室', desc: '会议室插座松动打火。', suggest: '更换插座面板。', rectDesc: '已更换插座面板并复测。', acceptResult: 'pass' },
  { category: '机械设备', area: '二号生产厂房', department: '生产部', risk: 'normal', status: 'cancelled', submitter: 'zhouqiang', assignee: 'wanggang', daysAgo: 10, building: '二号厂房', floor: '一层', location: '焊机区', desc: '误报：焊机外壳轻微划痕，经核实非安全隐患。', suggest: '' },
  { category: '危化品', area: '原料仓库', department: '仓储物流部', risk: 'major', status: 'rectified', submitter: 'hexing', assignee: 'xuemei', daysAgo: 12, building: '原料库', floor: '—', location: '资料室', desc: 'MSDS 卡片缺失、未上墙公示。', suggest: '补全 MSDS 并上墙公示。', rectDesc: '已补齐 23 份 MSDS 并上墙。' },
  { category: '高处作业', area: '一号生产厂房', department: '生产部', risk: 'normal', status: 'accepted', submitter: 'zhaomin', assignee: 'wanggang', daysAgo: 25, building: '一号厂房', floor: '一层', location: '登高梯', desc: '登高梯脚垫缺失，使用时易滑动。', suggest: '更换防滑脚垫。', rectDesc: '已更换防滑脚垫。', acceptResult: 'pass' },
  { category: '消防安全', area: '厂区物流通道', department: '行政管理部', risk: 'normal', status: 'pending_assign', submitter: 'donglei', daysAgo: 0, building: '厂区道路', floor: '—', location: '消防栓', desc: '厂区道路消防栓标识褪色不明显。', suggest: '重新涂刷消防栓标识。' },
  { category: '用电安全', area: '锅炉房', department: '设备动力部', risk: 'critical', status: 'assigned', submitter: 'zhengtao', assignee: 'liwei', daysAgo: 3, building: '锅炉房', floor: '一层', location: '控制柜', desc: '锅炉控制柜内存在裸露带电端子无防护。', suggest: '加装绝缘挡板并上锁管理。' },
  { category: '机械设备', area: '一号生产厂房', department: '生产部', risk: 'major', status: 'rejected', submitter: 'zhaomin', assignee: 'wanggang', daysAgo: 9, building: '一号厂房', floor: '一层', location: '防护罩', desc: '机械防护罩拆除后未恢复固定。', suggest: '恢复固定式防护罩。', rectDesc: '仅临时绑扎未恢复固定。', acceptResult: 'fail', rejectReason: '防护罩未恢复为固定式，存在脱落风险，退回重新整改。' },
  { category: '职业健康', area: '二号生产厂房', department: '生产部', risk: 'normal', status: 'accepted', submitter: 'sunli', assignee: 'wanggang', daysAgo: 15, building: '二号厂房', floor: '喷涂区', location: '岗位', desc: '噪声岗位未张贴职业危害警示标识。', suggest: '张贴噪声有害警示与护耳器提示。', rectDesc: '已张贴噪声警示与护耳器提示。', acceptResult: 'pass' },
  { category: '危化品', area: '原料仓库', department: '仓储物流部', risk: 'normal', status: 'accepted', submitter: 'hexing', assignee: 'xuemei', daysAgo: 19, building: '原料库', floor: '—', location: '收发台', desc: '危化品出入库台账登记不及时。', suggest: '落实双人收发与日清台账。', rectDesc: '已执行双人复核收发。', acceptResult: 'pass' },
  { category: '消防安全', area: '一号生产厂房', department: '生产部', risk: 'major', status: 'rectified', submitter: 'zhaomin', assignee: 'wanggang', daysAgo: 8, building: '一号厂房', floor: '一层', location: '疏散区', desc: '疏散指示标志部分不亮。', suggest: '更换损坏灯具并月度测试。', rectDesc: '已更换 5 处损坏灯具并测试正常。' },
  { category: '用电安全', area: '配电室', department: '设备动力部', risk: 'normal', status: 'accepted', submitter: 'wujun', assignee: 'liwei', daysAgo: 17, building: '配电室', floor: '—', location: '门口', desc: '配电室挡鼠板高度不足。', suggest: '加高至 60cm 并封堵孔洞。', rectDesc: '已加高挡鼠板至 60cm 并封堵孔洞。', acceptResult: 'pass' },
  { category: '高处作业', area: '二号生产厂房', department: '生产部', risk: 'major', status: 'assigned', submitter: 'zhouqiang', assignee: 'wanggang', daysAgo: 2, building: '二号厂房', floor: '外立面', location: '吊板', desc: '外墙清洗吊板无安全锁止装置。', suggest: '配重与锁止装置检查合格后方可作业。' },
  { category: '机械设备', area: '锅炉房', department: '设备动力部', risk: 'normal', status: 'accepted', submitter: 'zhengtao', assignee: 'liwei', daysAgo: 21, building: '锅炉房', floor: '一层', location: '压力表', desc: '压力表未定期校验。', suggest: '送检并贴校验标签。', rectDesc: '压力表已送检并在有效期内。', acceptResult: 'pass' },
];

type WpSeed = {
  type: string; isHazardous: boolean; area: string; department: string; applicant: string;
  status: string; daysAgo: number; content: string; operators?: string[]; supervisor?: string;
  location?: string; reviewer?: string; approver?: string; reviewOpinion?: string;
  approvalOpinion?: string; rejectReason?: string; printCount?: number;
};

const WORK_PERMITS: WpSeed[] = [
  { type: 'hot_work', isHazardous: true, area: '一号生产厂房', department: '生产部', applicant: 'zhaomin', status: 'pending_review', daysAgo: 1, content: '焊接不锈钢周转支架，使用乙炔氧气焰，周边有易燃包装物。', operators: ['赵敏', '周强'], supervisor: '王刚', location: '一号厂房焊接区' },
  { type: 'high_altitude', isHazardous: true, area: '二号生产厂房', department: '生产部', applicant: 'zhouqiang', status: 'reviewing', daysAgo: 2, content: '屋面防水涂料施工，登高约 4 米。', operators: ['周强'], supervisor: '王刚', location: '二号厂房屋面' },
  { type: 'confined_space', isHazardous: true, area: '原料仓库', department: '仓储物流部', applicant: 'hexing', status: 'approved', daysAgo: 3, content: '乙醇储罐内部清污作业，需气体检测与通风。', reviewer: 'chenjing', approver: 'xuemei', operators: ['何星'], supervisor: '薛梅', location: '原料库罐区', reviewOpinion: '气体检测与通风方案已确认，同意进入。', approvalOpinion: '批准，须严格执行作业票安全措施。', printCount: 2 },
  { type: 'lifting', isHazardous: true, area: '一号生产厂房', department: '生产部', applicant: 'zhouqiang', status: 'completed', daysAgo: 6, content: '吊装大型模具入位，使用 5 吨行车。', reviewer: 'liuyang', approver: 'wanggang', operators: ['周强', '赵敏'], supervisor: '王刚', location: '一号厂房', reviewOpinion: '吊装方案与指挥配置合格。', approvalOpinion: '批准吊装。', printCount: 3 },
  { type: 'excavation', isHazardous: false, area: '厂区物流通道', department: '行政管理部', applicant: 'donglei', status: 'pending_review', daysAgo: 1, content: '开挖电缆沟，深度约 0.8 米。', operators: ['董磊'], supervisor: '郭华', location: '厂区主干道' },
  { type: 'temporary_electricity', isHazardous: false, area: '二号生产厂房', department: '生产部', applicant: 'sunli', status: 'approved', daysAgo: 4, content: '临时照明配电，含移动配电箱。', reviewer: 'chenjing', operators: ['孙丽'], supervisor: '王刚', location: '二号厂房', reviewOpinion: '漏保与线缆检查合格，同意接电。', printCount: 1 },
  { type: 'blind', isHazardous: true, area: '原料仓库', department: '仓储物流部', applicant: 'hexing', status: 'rejected', daysAgo: 2, content: '管廊盲板抽堵作业。', reviewer: 'liuyang', rejectReason: '未提供盲板位置图与管线隔离确认单，退回补充。', location: '原料库管廊' },
  { type: 'hot_work', isHazardous: true, area: '锅炉房', department: '设备动力部', applicant: 'zhengtao', status: 'approved', daysAgo: 3, content: '切割更换管道，使用乙炔焰。', reviewer: 'chenjing', approver: 'liwei', operators: ['郑涛'], supervisor: '李伟', location: '锅炉房', reviewOpinion: '动火点周边清理合格。', approvalOpinion: '批准动火。', printCount: 1 },
  { type: 'high_altitude', isHazardous: true, area: '综合办公楼', department: '行政管理部', applicant: 'donglei', status: 'completed', daysAgo: 5, content: '外墙玻璃清洗，登高约 6 米。', reviewer: 'liuyang', approver: 'guohua', operators: ['董磊'], supervisor: '郭华', location: '办公楼外立面', reviewOpinion: '生命线与双钩检查合格。', approvalOpinion: '批准作业。', printCount: 2 },
  { type: 'lifting', isHazardous: true, area: '成品仓库', department: '仓储物流部', applicant: 'hexing', status: 'reviewing', daysAgo: 2, content: '叉车配合吊装货架，使用 3 吨叉车。', reviewer: 'liuyang', operators: ['何星'], supervisor: '薛梅', location: '成品仓库' },
  { type: 'confined_space', isHazardous: true, area: '配电室', department: '设备动力部', applicant: 'wujun', status: 'pending_review', daysAgo: 0, content: '电缆沟内接线作业，需通风检测。', operators: ['吴军'], supervisor: '李伟', location: '配电室电缆沟' },
  { type: 'other', isHazardous: false, area: '综合办公楼', department: '质量管理部', applicant: 'lina', status: 'completed', daysAgo: 7, content: '实验室设备移位与重新定位。', reviewer: 'liuyang', approver: 'yangfan', operators: ['李娜'], supervisor: '杨帆', location: '质检实验室', reviewOpinion: '移位方案安全。', approvalOpinion: '批准。', printCount: 1 },
];

const QR_CODES = [
  { name: '一号厂房-车间入口', scene: 'workshop', area: '一号生产厂房' },
  { name: '二号厂房-焊装区', scene: 'workshop', area: '二号生产厂房' },
  { name: '原料仓库-收发处', scene: 'warehouse', area: '原料仓库' },
  { name: '成品仓库-出货口', scene: 'warehouse', area: '成品仓库' },
  { name: '综合办公楼-大堂', scene: 'office', area: '综合办公楼' },
  { name: '厂区西门-物流通道', scene: 'gate', area: '厂区物流通道' },
];

// 现场检查记录：引用 WORK_PERMITS 下标（0-based）
const CHECKS = [
  { wp: 3, checker: '刘洋', note: '作业前气体检测合格，防护到位。', days: 5, items: { '个人防护用品': true, '作业警戒与隔离': true, '气体检测合格': true, '消防器材到位': true } },
  { wp: 8, checker: '陈静', note: '动火点周边易燃物已清理。', days: 4, items: { '动火点清理': true, '灭火器配备': true, '监护人在场': true } },
  { wp: 11, checker: '刘洋', note: '临边防护与生命线检查合格。', days: 4, items: { '生命线可靠': true, '安全带双钩': true, '地面监护': true } },
  { wp: 11, checker: '郭华', note: '收工复核，现场已恢复。', days: 4, items: { '工具清点': true, '现场恢复': true } },
];

// ============ 作业申请单（全流程演示：现场移动端执行 / 看板 / 统计）============
type AppInsp = { inspector: string; result: 'normal' | 'abnormal'; note: string; hoursAgo: number; source?: 'manual' | 'ocr' };
type AppSeed = {
  permitNo: string;
  jobName: string;
  applicant: string;
  dept: string;
  area: string;
  location: string;
  content: string;
  supervisor: string;
  operators: string[];
  contractor: string; // 承包商单位（统计维度）
  status: 'draft' | 'pending_review' | 'rejected' | 'reviewing' | 'approved' | 'printed' | 'paused' | 'finished' | 'completed' | 'voided';
  involvesHazardous: boolean;
  hazTypes: string[]; // 关联危险作业票类型
  reviewer: string;
  approver?: string;
  briefing: 'none' | 'draft' | 'done';
  briefPoints: string[];
  trainer: string;
  trainees: string[];
  inspections: AppInsp[];
  pauseReason?: string;
  pausedBy?: string;
  planFrom: number; // planStart 相对今天的天偏移（0=今天 08:00，-1=昨天）
  planDur: number; // 计划持续天数
  printCount?: number;
};

const APPLICATIONS_SAMPLE: AppSeed[] = [
  {
    permitNo: '', // 编号由 expandApplications 按新规则生成
    jobName: '一号厂房焊接支架动火作业', applicant: 'zhaomin', dept: '生产部', area: '一号生产厂房',
    location: '一号厂房焊接区', content: '焊接不锈钢周转支架，使用乙炔氧气焰，作业前须清理周边易燃包装物并配备灭火器材。',
    supervisor: '王刚', operators: ['赵敏', '周强'], contractor: '恒达机电安装有限公司',
    status: 'approved', involvesHazardous: true, hazTypes: ['hot_work'], reviewer: 'chenjing', approver: 'wanggang',
    briefing: 'draft',
    briefPoints: ['确认动火点周边 10 米内无易燃易爆物', '配备不少于 2 具灭火器并指定监护人', '作业人持有效动火作业证', '作业结束后检查有无阴燃火种'],
    trainer: '陈静', trainees: ['赵敏', '周强'],
    inspections: [],
    planFrom: 1, planDur: 1,
  },
  {
    permitNo: '', // 编号由 expandApplications 按新规则生成
    jobName: '原料库乙醇储罐内部清污（受限空间）', applicant: 'hexing', dept: '仓储物流部', area: '原料仓库',
    location: '原料库罐区 T-03', content: '乙醇储罐内部清污作业，需持续气体检测与强制通风，办理受限空间进入许可。',
    supervisor: '薛梅', operators: ['何星'], contractor: '蓝清环保工程有限公司',
    status: 'printed', involvesHazardous: true, hazTypes: ['confined_space'], reviewer: 'chenjing', approver: 'xuemei',
    briefing: 'done',
    briefPoints: ['进入前连续检测氧含量、可燃气体、有毒气体并记录', '设置罐外专职监护人，保持呼叫联系', '强制通风运行，罐内照明使用 12V 防爆灯', '配备正压式空气呼吸器与救援三脚架'],
    trainer: '陈静', trainees: ['何星', '薛梅'],
    inspections: [
      { inspector: '刘洋', result: 'normal', note: '进入前气体检测合格（O2 20.9%，VOC 0ppm），通风运行正常。', hoursAgo: 5 },
      { inspector: '陈静', result: 'normal', note: '监护人在岗，救援器材到位，作业中复检合格。', hoursAgo: 2 },
    ],
    planFrom: 0, planDur: 1, printCount: 2,
  },
  {
    permitNo: '', // 编号由 expandApplications 按新规则生成
    jobName: '二号厂房屋面防水高处作业', applicant: 'zhouqiang', dept: '生产部', area: '二号生产厂房',
    location: '二号厂房屋面', content: '屋面防水涂料施工，登高约 4 米，沿临边搭设生命线并使用双钩安全带。',
    supervisor: '王刚', operators: ['周强'], contractor: '正泰建筑防水有限公司',
    status: 'paused', involvesHazardous: true, hazTypes: ['high_altitude'], reviewer: 'liuyang', approver: 'wanggang',
    briefing: 'done',
    briefPoints: ['临边生命线可靠固定，安全带高挂低用', '五级以上大风或雨天停止作业', '地面设置警戒区与监护人', '工具系防坠绳，严禁上下抛掷'],
    trainer: '刘洋', trainees: ['周强'],
    inspections: [
      { inspector: '刘洋', result: 'abnormal', note: '午后风力增大至 6 级，且发现一处生命线锚点松动，已令暂停整改。', hoursAgo: 3 },
    ],
    pauseReason: '风力超过 5 级且生命线锚点需重新加固，暂停作业待条件恢复。', pausedBy: 'liuyang',
    planFrom: 0, planDur: 2, printCount: 1,
  },
  {
    permitNo: '', // 编号由 expandApplications 按新规则生成
    jobName: '锅炉房管道切割更换动火作业', applicant: 'zhengtao', dept: '设备动力部', area: '锅炉房',
    location: '锅炉房一层管廊', content: '切割更换蒸汽管道，使用乙炔焰，作业前完成管线隔离与泄压确认。',
    supervisor: '李伟', operators: ['郑涛'], contractor: '恒达机电安装有限公司',
    status: 'finished', involvesHazardous: true, hazTypes: ['hot_work', 'blind'], reviewer: 'chenjing', approver: 'liwei',
    briefing: 'done',
    briefPoints: ['管道隔离、泄压、置换合格后方可动火', '动火点铺设接火盘，配备灭火器', '设专职监护人全程监护', '盲板抽堵按盲板图逐一确认并挂牌'],
    trainer: '陈静', trainees: ['郑涛', '李伟'],
    inspections: [
      { inspector: '陈静', result: 'normal', note: '管线隔离与盲板确认合格，动火点清理到位。', hoursAgo: 30 },
      { inspector: '刘洋', result: 'normal', note: '作业中复检，接火盘与灭火器到位，无异常。', hoursAgo: 26, source: 'ocr' },
      { inspector: '李伟', result: 'normal', note: '完工复核，现场无遗留火种，管道复位。', hoursAgo: 24 },
    ],
    planFrom: -1, planDur: 1, printCount: 1,
  },
  {
    permitNo: '', // 编号由 expandApplications 按新规则生成
    jobName: '办公楼外墙玻璃清洗高处作业', applicant: 'donglei', dept: '行政管理部', area: '综合办公楼',
    location: '办公楼南立面', content: '外墙玻璃清洗，登高约 6 米，使用吊篮并检查配重与锁止装置。',
    supervisor: '郭华', operators: ['董磊'], contractor: '洁净高空作业服务有限公司',
    status: 'completed', involvesHazardous: true, hazTypes: ['high_altitude'], reviewer: 'liuyang', approver: 'guohua',
    briefing: 'done',
    briefPoints: ['吊篮配重与锁止装置检查合格', '安全带独立生命线，与吊篮分离', '地面设置警戒并有专人监护', '恶劣天气停止作业'],
    trainer: '刘洋', trainees: ['董磊'],
    inspections: [
      { inspector: '刘洋', result: 'normal', note: '吊篮与生命线检查合格，警戒到位。', hoursAgo: 120 },
      { inspector: '郭华', result: 'normal', note: '完工复核，现场恢复，工具清点无遗漏。', hoursAgo: 110 },
    ],
    planFrom: -5, planDur: 1, printCount: 2,
  },
];

// 基于样例模板批量扩展出 220 组作业申请单（覆盖各状态/区域/危险作业类型/承包商），
// 现场安全交底自动带出申请单第3步预设清单，仅承包商负责人签字（无管理部门签字）。
const HAZARD_TYPE_POOL = ['hot_work', 'high_altitude', 'confined_space', 'lifting', 'excavation', 'temporary_electricity', 'blind', 'other'];
const JOB_TEMPLATE: Record<string, { names: string[]; content: string; points: string[] }> = {
  hot_work: { names: ['焊接支架动火作业', '管道切割更换动火', '设备外壳补焊动火', '罐区周边动火作业'], content: '使用乙炔氧气焰动火，作业前须清理周边易燃物并配备灭火器材，设专职监护人。', points: ['动火点周边 10 米内无易燃易爆物', '配备不少于 2 具灭火器并指定监护人', '作业人持有效动火作业证', '作业结束检查有无阴燃火种'] },
  high_altitude: { names: ['屋面防水高处作业', '外墙清洗高处作业', '管架登高作业', '临边检修高处作业'], content: '登高作业，沿临边搭设生命线并使用双钩安全带，恶劣天气停止作业。', points: ['临边生命线可靠固定，安全带高挂低用', '五级以上大风或雨天停止作业', '地面设置警戒区与监护人', '工具系防坠绳，严禁上下抛掷'] },
  confined_space: { names: ['乙醇储罐内部清污（受限空间）', '反应釜内部检修（受限空间）', '地下管沟作业', '污水池清淤（受限空间）'], content: '受限空间进入，需持续气体检测与强制通风，办理受限空间进入许可。', points: ['进入前连续检测氧含量、可燃气体、有毒气体并记录', '设置罐外专职监护人，保持呼叫联系', '强制通风运行，照明使用 12V 防爆灯', '配备正压式空气呼吸器与救援三脚架'] },
  lifting: { names: ['大型模具吊装', '货架配合吊装', '设备就位吊装', '管道吊装就位'], content: '吊装作业，使用行车/叉车配合，须设吊装指挥并划定警戒区。', points: ['吊装方案与指挥配置合格', '吊具与索具检查无裂纹', '吊物下方严禁站人', '设警戒区并专人监护'] },
  excavation: { names: ['电缆沟开挖', '设备基础开挖', '管廊沟槽开挖', '场地管沟开挖'], content: '开挖作业，须查明地下管线并设置边坡/支护。', points: ['查明地下管线走向并标识', '按深度设边坡或支护', '周边设警示与护栏', '夜间设警示灯'] },
  temporary_electricity: { names: ['临时照明配电', '移动配电箱接电', '设备调试临时用电', '施工临时供电'], content: '临时用电，含移动配电箱与漏保，线缆须架空或穿管保护。', points: ['漏保动作试验合格', '线缆无破损并架空/穿管', '配电箱上锁并挂标识', '电工持证作业'] },
  blind: { names: ['管廊盲板抽堵', '储罐进出口盲板作业', '界区盲板隔离作业'], content: '盲板抽堵作业，按盲板图逐一确认管线隔离并挂牌。', points: ['管线隔离、泄压、置换合格', '按盲板图逐一确认并挂牌', '设专职监护人', '盲板抽堵使用防爆工具'] },
  other: { names: ['实验室设备移位', '货架重新布局', '地面标识翻新', '区域物理隔离设置'], content: '一般作业，落实个人防护与现场清理。', points: ['落实个人防护用品', '作业区域警示隔离', '工具设备状态检查', '完工现场清理恢复'] },
};
const CONTRACTOR_POOL = ['恒达机电安装有限公司', '蓝清环保工程有限公司', '正泰建筑防水有限公司', '洁净高空作业服务有限公司', '宏远设备检修有限公司', '鼎盛脚手架工程有限公司', '瑞安危险作业服务有限公司', '华兴防腐工程有限公司'];
// 各承包商单位的负责人（外部承包商人员，区别于公司内部管理/监护人员）
const CONTRACTOR_HEAD: Record<string, string> = {
  '恒达机电安装有限公司': '孙建国',
  '蓝清环保工程有限公司': '李文斌',
  '正泰建筑防水有限公司': '王志强',
  '洁净高空作业服务有限公司': '陈晓东',
  '宏远设备检修有限公司': '赵立军',
  '鼎盛脚手架工程有限公司': '刘海峰',
  '瑞安危险作业服务有限公司': '黄海涛',
  '华兴防腐工程有限公司': '周国华',
};
const HAZARD_LABELS: Record<string, string> = {
  hot_work: '动火作业',
  high_altitude: '高处作业',
  confined_space: '受限空间',
  lifting: '吊装作业',
  excavation: '挖掘作业',
  temporary_electricity: '临时用电',
  blind: '盲板抽堵',
  other: '其它危险作业',
};
const OPERATOR_POOL = ['赵敏', '周强', '何星', '郑涛', '孙丽', '吴军', '董磊', '李娜', '王磊', '张涛', '刘强', '陈鹏', '杨洋', '黄勇', '马超', '徐峰', '胡兵', '林峰'];
const APPLICANT_POOL = ['zhaomin', 'sunli', 'zhouqiang', 'wujun', 'zhengtao', 'hexing', 'lina', 'donglei', 'wanggang', 'liwei', 'xuemei', 'yangfan', 'guohua', 'liuyang', 'chenjing'];
const DEPT_SUPERVISOR: Record<string, string> = { '生产部': '王刚', '设备动力部': '李伟', '仓储物流部': '薛梅', '质量管理部': '杨帆', '行政管理部': '郭华', '安全环保部': '刘洋' };
const DEPT_APPROVER: Record<string, string> = { '生产部': 'wanggang', '设备动力部': 'liwei', '仓储物流部': 'xuemei', '质量管理部': 'yangfan', '行政管理部': 'guohua', '安全环保部': 'liuyang' };
const AREA_POOL = ['一号生产厂房', '二号生产厂房', '原料仓库', '成品仓库', '综合办公楼', '厂区物流通道', '锅炉房', '配电室'];
const STATUS_POOL: AppSeed['status'][] = ['completed', 'completed', 'completed', 'finished', 'finished', 'printed', 'printed', 'approved', 'approved', 'paused'];
const INSPECTOR_POOL = ['刘洋', '陈静', '王刚', '李伟', '薛梅', '杨帆', '郭华', '赵敏'];
function pick<T>(a: T[], i: number): T { return a[i % a.length]; }
function rnd(n: number): number { return Math.floor(Math.random() * n); }

function expandApplications(sample: AppSeed[], n: number): AppSeed[] {
  const out: AppSeed[] = [];
  for (let i = 0; i < n; i++) {
    const applicant = APPLICANT_POOL[(i * 7 + rnd(5)) % APPLICANT_POOL.length];
    const dept = userDept(applicant) || sample[i % sample.length].dept;
    const area = pick(AREA_POOL, i * 3 + rnd(8));
    const status = pick(STATUS_POOL, i);
    // 非常规作业（动火/高处/受限空间/吊装/临时用电/断路/动土/盲板等）才标为危险作业；
    // 常规作业（普通检维修/清洁/巡检等）不挂危险作业票，仅做现场交底。约 30% 为危险作业。
    const haz = Math.random() < 0.3;
    const hazTypes: string[] = [];
    if (haz) {
      const cnt = 1 + rnd(2);
      for (let k = 0; k < cnt; k++) {
        const t = pick(HAZARD_TYPE_POOL, i * 2 + k + rnd(8));
        if (!hazTypes.includes(t)) hazTypes.push(t);
      }
    }
    const tplKey = hazTypes[0] || 'other';
    const tpl = JOB_TEMPLATE[tplKey];
    const jobName = `${pick(tpl.names, i * 2 + rnd(4))}`;
    const ops: string[] = [];
    const oc = 1 + rnd(3);
    for (let k = 0; k < oc; k++) ops.push(pick(OPERATOR_POOL, i * 5 + k + rnd(7)));
    const contractor = pick(CONTRACTOR_POOL, i * 3 + rnd(5));
    const supervisor = DEPT_SUPERVISOR[dept] || '王刚';
    const approverU = DEPT_APPROVER[dept] || 'wanggang';
    const reviewer = applicant === 'liuyang' ? 'chenjing' : applicant === 'chenjing' ? 'liuyang' : pick(['chenjing', 'liuyang'], i);
    const briefing: AppSeed['briefing'] = status === 'approved' ? (Math.random() < 0.5 ? 'draft' : 'done') : 'done';
    const trainees = Array.from(new Set([...ops, supervisor]));
    const trainer = Math.random() < 0.5 ? '陈静' : '刘洋';
    const planFrom = -10 + rnd(12); // -10..1
    const planDur = 1 + rnd(3);
    const inspections: AppSeed['inspections'] = [];
    if (status === 'printed' || status === 'finished' || status === 'completed') {
      const ic = 1 + rnd(2);
      for (let k = 0; k < ic; k++) {
        const ab = status === 'completed' ? false : Math.random() < 0.12;
        inspections.push({
          inspector: pick(INSPECTOR_POOL, i * 3 + k + rnd(6)),
          result: ab ? 'abnormal' : 'normal',
          note: ab ? '巡检发现一项防护措施不到位，已现场要求整改并复查合格。' : '作业前措施与防护到位，气体检测/警戒/监护符合要求，作业中复检无异常。',
          hoursAgo: 2 + rnd(70),
          source: Math.random() < 0.3 ? 'ocr' : 'manual',
        });
      }
    } else if (status === 'paused') {
      inspections.push({ inspector: pick(INSPECTOR_POOL, i), result: 'abnormal', note: '巡检发现防护条件不满足（风力超标/锚点松动），已令暂停整改。', hoursAgo: 2 + rnd(6) });
    }
    const app: AppSeed = {
      permitNo: seedPermitNo(hazTypes.length ? hazTypes[0] : 'routine', i + 1),
      jobName,
      applicant,
      dept,
      area,
      location: `${area} ${pick(['A区', 'B区', '作业点', '检修位', '罐区', '管廊', '屋面', '外立面'], i + rnd(6))}`,
      content: tpl.content,
      supervisor,
      operators: ops,
      contractor,
      status,
      involvesHazardous: hazTypes.length > 0,
      hazTypes,
      reviewer,
      approver: approverU,
      briefing,
      briefPoints: tpl.points,
      trainer,
      trainees,
      inspections,
      planFrom,
      planDur,
      printCount: status === 'approved' ? 0 : 1 + rnd(3),
    };
    if (status === 'paused') {
      app.pauseReason = '巡检发现现场防护条件不满足，暂停作业待整改复核后恢复。';
      app.pausedBy = reviewer;
    }
    out.push(app);
  }
  return out;
}
// 种子正式号按前缀全局流水（所有种子来源共享，避免同表内 unique 冲突；须在 expandApplications 调用前声明）
const _seedSeqByPrefix = new Map<string, number>();
const APPLICATIONS = expandApplications(APPLICATIONS_SAMPLE, 250);
// 案例随机停留于不同节点（覆盖 草稿/待审/驳回/审核中/已批准/执行/暂停/完工/归档/作废）
const APP_STATUS_POOL = ['draft', 'pending_review', 'rejected', 'reviewing', 'approved', 'printed', 'paused', 'finished', 'completed', 'voided'] as const;
APPLICATIONS.forEach((a, i) => {
  a.status = APP_STATUS_POOL[rnd(APP_STATUS_POOL.length)];
  // 编号按新规则：草稿=SQ 临时号；提交后（含被拒）=正式类型号（一单一号，危险按具体类型前缀）
  if (a.status === 'draft') {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    a.permitNo = `SQ${ym}${String(i + 1).padStart(4, '0')}`;
  } else {
    a.permitNo = seedPermitNo(a.hazTypes.length ? a.hazTypes[0] : 'routine', i + 1);
  }
});

// ============ 工具函数 ============
// 按新编号规则生成正式号：{类型前缀}-{YYYYMM}-{4位流水}（与业务 genPermitNo 一致，杜绝 ZY 旧格式）。
// 所有种子来源（纸质票/电子票/申请单）共享按前缀的全局流水（_seedSeqByPrefix 见文件上部声明）。
function seedPermitNo(type: string, _seq?: number): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = PERMIT_NO_PREFIX[type] || PERMIT_NO_PREFIX.other;
  const n = (_seedSeqByPrefix.get(prefix) || 0) + 1;
  _seedSeqByPrefix.set(prefix, n);
  return `${prefix}-${ym}-${String(n).padStart(4, '0')}`;
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}
function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 3600000);
}
// 今天/相对日的 08:00
function planStartAt(dayOffset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(8, 0, 0, 0);
  return d;
}
// 生成手写体电子签名（SVG data URI，模拟现场手写签名）
function sigImg(name: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='46'>` +
    `<text x='8' y='34' font-family='cursive,KaiTi,STKaiti' font-size='30' fill='#1a2b4a'>${name}</text>` +
    `<path d='M6 40 C40 44, 120 44, 172 38' stroke='#1a2b4a' stroke-width='1.2' fill='none' opacity='0.6'/></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}
function userName(un: string): string {
  return USERS.find((u) => u.username === un)?.name ?? un;
}
function userDept(un: string): string {
  return USERS.find((u) => u.username === un)?.department ?? '';
}

function buildHazard(h: HzSeed, i: number, userIdByName: Map<string, string>): any {
  const created = daysAgo(h.daysAgo);
  const status = h.status;
  const assigneeName = h.assignee ? userName(h.assignee) : null;
  return {
    hazardNo: `HZ-${String(new Date().getFullYear())}${String(i + 1).padStart(4, '0')}`,
    submitterUserId: userIdByName.get(h.submitter) ?? null,
    submitterName: userName(h.submitter),
    isAnonymous: false,
    building: h.building ?? null,
    floor: h.floor ?? null,
    location: h.location ?? null,
    area: mapArea(h.area),
    department: h.department,
    description: h.desc,
    suggestDepartment: h.department,
    suggestAction: h.suggest ?? null,
    aiDescription: h.desc,
    aiCategory: h.category,
    aiRiskLevel: h.risk,
    aiSuggestion: h.suggest ?? null,
    categoryApproved: [],
    riskLevel: h.risk,
    status,
    allocatedDepartment: status !== 'pending_assign' && status !== 'cancelled' ? (h.assignee ? userDept(h.assignee) : h.department) : null,
    assigneeId: h.assignee ? (userIdByName.get(h.assignee) ?? null) : null,
    assigneeName,
    deadline: addDays(created, h.risk === 'critical' ? 1 : h.risk === 'major' ? 3 : 7),
    rectificationDesc: h.rectDesc ?? null,
    rectificationDate: h.rectDesc ? addDays(created, 2) : null,
    acceptanceResult: h.acceptResult ?? null,
    rejectionReason: h.rejectReason ?? null,
    isPublic: '是',
    createdAt: created,
    updatedAt: h.rectDesc ? addDays(created, 2) : created,
  };
}

function buildWp(w: WpSeed, i: number, userIdByName: Map<string, string>): any {
  const created = daysAgo(w.daysAgo);
  const wpStart = created;
  const wpEnd = addDays(created, 1);
  return {
    permitNo: seedPermitNo(w.type, i + 1),
    type: w.type,
    isHazardous: w.isHazardous,
    // 风险等级由票面信息自动判定，驱动审批层级（低=2级/中=3级/重大=4级）
    riskLevel: evaluateRiskLevel({ type: w.type, isHazardous: w.isHazardous, startTime: wpStart, endTime: wpEnd }),
    area: mapArea(w.area),
    location: w.location ?? null,
    startTime: created,
    endTime: addDays(created, 1),
    applicantId: userIdByName.get(w.applicant) ?? null,
    applicantName: userName(w.applicant),
    department: w.department,
    operatorNames: w.operators ?? [],
    supervisorName: w.supervisor ?? null,
    content: w.content,
    safetyMeasures: [],
    status: w.status,
    reviewerId: w.reviewer ? (userIdByName.get(w.reviewer) ?? null) : null,
    reviewerName: w.reviewer ? userName(w.reviewer) : null,
    reviewOpinion: w.reviewOpinion ?? w.rejectReason ?? null,
    approverId: w.approver ? (userIdByName.get(w.approver) ?? null) : null,
    approverName: w.approver ? userName(w.approver) : null,
    approvalOpinion: w.approvalOpinion ?? null,
    printCount: w.printCount ?? 0,
    createdAt: created,
    updatedAt: created,
  };
}

// 首次启动初始化：权限点、角色、管理员账号、默认配置。
// 幂等：已存在 admin 则跳过。
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private auth: AuthService,
  ) {}

  async onModuleInit() {
    // 权限点每次启动都保证存在（新增权限点时不会因“已有用户”而被跳过）
    await this.ensurePermissions();
    await this.seed();
    // 保证管理员账号永远可用（密码被改错/遗忘时自动还原为默认）
    await this.ensureAdmin();
    // 演示数据：本地沙箱默认开启（.env 中 SEED_DEMO=1）。
    // 已生成过则跳过；需重新生成请设置 SEED_DEMO_FORCE=1。
    if (process.env.SEED_DEMO === '1' || process.env.SEED_DEMO_FORCE === '1') {
      await this.seedDemo(process.env.SEED_DEMO_FORCE === '1');
    }
    // 清空所有历史作业票 + 按新规则模拟 50 个分布在不同状态（用户要求）
    if (process.env.SEED_LARGE_TEST === '1' || process.env.SEED_LARGE_TEST_FORCE === '1') {
      await this.seedLargeTestDataset(process.env.SEED_LARGE_TEST_FORCE === '1');
    }
    // 模拟常规作业票完整作业过程（受 SEED_SIM_ROUTINE 数量控制，幂等）
    if (process.env.SEED_SIM_ROUTINE) {
      try {
        await this.simulateRoutineWorkflow();
      } catch (e) {
        this.logger.warn(`模拟常规作业票失败（忽略）: ${(e as Error).message}`);
      }
    }
  }

  /**
   * 清空 work_permits + 按新规则模拟 50 个作业票（分布在不同状态/类型）
   * 状态分组映射到 EPERMIT_CATEGORIES（全部/审批中/交底中/作业中/已完成/已归档）。
   * 默认仅当工作票表为空时执行（force=true 时强制清空并重建）。
   */
  private async seedLargeTestDataset(force = false) {
    // 先清空所有历史工作票（含级联：inspection_records/safety_briefings/entry_registrations）
    const existing = await this.db.select({ count: count() }).from(schema.workPermits);
    if ((existing[0]?.count ?? 0) > 0 && !force) {
      this.logger.log('[seedLargeTestDataset] 工作票表非空，跳过（设 SEED_LARGE_TEST_FORCE=1 强制重建）');
      return;
    }
    await this.db.delete(schema.workPermits);

    const adminRow = await this.db.select().from(schema.users).where(eq(schema.users.username, 'admin')).limit(1);
    const adminId = adminRow[0]?.id;

    const types = ['routine', 'hot_work', 'high_altitude', 'confined_space', 'lifting', 'excavation', 'temporary_electricity', 'blind', 'other'];
    const statusPlan: Array<{ status: string; count: number }> = [
      { status: 'draft',         count: 10 }, // 仅「全部」计数
      { status: 'pending_review', count: 8 }, // → 审批中
      { status: 'reviewing',     count: 8 }, // → 审批中
      { status: 'printed',       count: 8 }, // → 交底中
      { status: 'paused',        count: 8 }, // → 作业中
      { status: 'finished',      count: 4 }, // → 已完成
      { status: 'completed',     count: 4 }, // → 已归档
    ];
    const areas = ['一号生产厂房', '二号生产厂房', '综合办公楼'];
    const ym = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const permitNoCounters = new Map<string, number>();

    const wpRows: any[] = [];
    let i = 0;
    for (const grp of statusPlan) {
      for (let n = 0; n < grp.count; n++) {
        i++;
        const type = types[i % types.length];
        const isHazard = type !== 'routine';
        const prefix = `${PERMIT_NO_PREFIX[type] || PERMIT_NO_PREFIX.other}-${ym}-`;
        const seq = (permitNoCounters.get(prefix) || 0) + 1;
        permitNoCounters.set(prefix, seq);
        const permitNo = `${prefix}${String(seq).padStart(4, '0')}`;

        const createdAt = new Date(Date.now() - 86400000 * (60 - i)); // 分布最近 60 天
        const base: any = {
          permitNo,
          type,
          isHazardous: isHazard,
          channel: 'electronic',
          area: areas[i % areas.length],
          location: `测试区域 ${i}`,
          startTime: new Date(Date.now() - 86400000 * 2 + 3600000 * i),
          endTime: new Date(Date.now() + 86400000 * 5),
          applicantId: adminId,
          applicantName: '系统管理员',
          department: '安全环保部',
          operatorNames: ['测试作业员A', '测试作业员B'],
          content: `模拟作业 #${i}（${type}/${grp.status}）`,
          status: grp.status,
          riskLevel: isHazard ? 'medium' : 'low',
          jsas: [
            { step: '施工准备', hazard: '环境检查', control: '佩戴防护用品' },
            { step: '正式作业', hazard: '操作风险', control: '监护人在场' },
          ],
          createdAt,
          updatedAt: createdAt,
        };

        // 按状态补审批/作业时间戳
        if (['pending_review', 'reviewing', 'printed', 'paused', 'finished', 'completed'].includes(grp.status)) {
          base.reviewerId = adminId;
          base.reviewerName = '系统管理员';
          base.reviewOpinion = '同意';
          base.reviewedAt = new Date(createdAt.getTime() + 600000);
        }
        if (['reviewing', 'printed', 'paused', 'finished', 'completed'].includes(grp.status)) {
          base.approverId = adminId;
          base.approverName = '系统管理员';
          base.approvalOpinion = '批准';
          base.approvedAt = new Date(createdAt.getTime() + 1200000);
        }
        if (['printed', 'paused', 'finished', 'completed'].includes(grp.status)) {
          base.ehsApproverId = adminId;
          base.ehsApproverName = '系统管理员';
          base.ehsApprovalOpinion = 'EHS 审核通过';
          base.ehsApprovedAt = new Date(createdAt.getTime() + 900000);
          base.printedAt = new Date(createdAt.getTime() + 1800000);
          base.printCount = 1;
        }
        if (['finished', 'completed'].includes(grp.status)) {
          base.finishedAt = new Date(createdAt.getTime() + 86400000);
        }
        if (grp.status === 'completed') {
          base.archivedAt = new Date(createdAt.getTime() + 86400000 * 2);
        }
        if (grp.status === 'paused') {
          base.pausedAt = new Date(createdAt.getTime() + 86400000);
          base.pausedByName = '林涛';
          base.pauseReason = '现场环境不达标，暂停整改';
        }

        wpRows.push(base);
      }
    }

    // 逐条插入：危险票需先创建对应的常规票并建立关联，模拟阶段不允许出现未关联常规票
    let inserted = 0;
    for (const row of wpRows) {
      if (row.isHazardous) {
        const [routine] = await this.db
          .insert(schema.workPermits)
          .values({
            permitNo: seedPermitNo('routine'),
            channel: 'electronic',
            type: 'routine',
            isHazardous: false,
            area: row.area,
            location: row.location,
            startTime: row.startTime,
            endTime: row.endTime,
            applicantId: row.applicantId,
            applicantName: row.applicantName,
            department: row.department,
            operatorNames: row.operatorNames,
            content: row.content,
            status: 'approved',
            riskLevel: 'low',
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })
          .returning({ id: schema.workPermits.id, permitNo: schema.workPermits.permitNo });
        row.linkedRoutineId = routine.id;
        row.linkedRoutineNo = routine.permitNo;
      }
      await this.db.insert(schema.workPermits).values(row);
      inserted++;
    }
    this.logger.log(`[seedLargeTestDataset] 已清空历史作业票并新建 ${inserted} 个模拟票（含为危险票自动创建的常规票，按状态分布：${statusPlan.map((s) => `${s.status}=${s.count}`).join(', ')})`);
  }

  // 始终执行的权限点同步（幂等）
  private async ensurePermissions() {
    await this.db
      .insert(schema.permissions)
      .values(PERMISSIONS.map((p) => ({ subject: p.subject, action: p.action, description: p.description })))
      .onConflictDoNothing();

    const permRows = await this.db.select().from(schema.permissions);
    const permMap = new Map(permRows.map((p) => [`${p.subject}:${p.action}`, p.id]));

    // 把新增权限点补关联给内置角色（幂等：仅补缺失关联，不删除已有）
    for (const r of ROLE_SEEDS) {
      const [role] = await this.db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.key, r.key))
        .limit(1);
      if (!role) continue;
      const links = r.perms
        .map((permKey) => ({ roleId: role.id, permissionId: permMap.get(permKey)! }))
        .filter((l) => l.permissionId);
      if (links.length) {
        await this.db.insert(schema.rolePermissions).values(links).onConflictDoNothing();
      }
    }
  }

  async seed() {
    const [u] = await this.db.select({ c: count() }).from(schema.users);
    if (Number(u?.c ?? 0) > 0) {
      this.logger.log('已存在用户，跳过基础种子初始化。');
      return;
    }
    this.logger.log('开始初始化基础数据……');
    // 1) 权限点（首次已在 onModuleInit 同步）
    const permRows = await this.db.select().from(schema.permissions);
    const permMap = new Map(permRows.map((p) => [`${p.subject}:${p.action}`, p.id]));

    // 2) 角色 + 角色权限
    for (const r of ROLE_SEEDS) {
      const [role] = await this.db.insert(schema.roles).values({ key: r.key, name: r.name, description: r.description }).returning({ id: schema.roles.id });
      const links = r.perms.map((permKey) => ({ roleId: role.id, permissionId: permMap.get(permKey)! })).filter((l) => l.permissionId);
      if (links.length) await this.db.insert(schema.rolePermissions).values(links).onConflictDoNothing();
    }

    // 3) 管理员账号（用户名 admin，默认密码，强制改密）
    const adminPwd = process.env.ADMIN_PASSWORD || 'Admin@123456';
    const [adminRole] = await this.db.select().from(schema.roles).where(eq(schema.roles.key, 'admin')).limit(1);
    const [admin] = await this.db
      .insert(schema.users)
      .values({
        username: 'admin',
        name: '系统管理员',
        passwordHash: await this.auth.hash(adminPwd),
        department: '安全环保部',
        status: 'active',
        mustChangePassword: true,
      })
      .returning({ id: schema.users.id });
    await this.db.insert(schema.userRoles).values({ userId: admin.id, roleId: adminRole.id });

    // 4) 默认风险等级（ upsert：新库插入，旧库更新名称/默认值）
    const RISK_LEVEL_SEEDS = [
      { level: 'low', name: '低风险', color: '#22c55e', defaultDeadline: 30, reminderDays: 7, sortOrder: 1 },
      { level: 'normal', name: '一般风险', color: '#84cc16', defaultDeadline: 7, reminderDays: 1, sortOrder: 2 },
      { level: 'major', name: '较大风险', color: '#f59e0b', defaultDeadline: 3, reminderDays: 1, sortOrder: 3 },
      { level: 'critical', name: '重大风险', color: '#ef4444', defaultDeadline: 1, reminderDays: 1, sortOrder: 4 },
    ];
    // 风险等级改为常量映射（2026-08 移除 risk_levels 配置表）

    // 5) 默认隐患类型
    await this.db.insert(schema.hazardTypes).values([
      { name: '消防安全', sortOrder: 1 },
      { name: '用电安全', sortOrder: 2 },
      { name: '机械设备', sortOrder: 3 },
      { name: '高处作业', sortOrder: 4 },
      { name: '危化品', sortOrder: 5 },
      { name: '职业健康', sortOrder: 6 },
      { name: '其他', sortOrder: 99 },
    ]).onConflictDoNothing();

    // 6) 默认 AI 提示词
    await this.db.insert(schema.systemConfig).values([
      { key: 'ai_prompt_hazard', value: '你是企业 EHS（环境、健康、安全）安全专家。请根据隐患描述，给出专业分析，包括隐患归纳、类别、风险等级（低风险/一般风险/较大风险/重大风险）、关联法规、整改建议、根本原因（5Why）、控制措施。' },
      { key: 'ai_prompt_work_permit', value: '你是企业 EHS 安全专家，擅长作业危险性分析（JSA）。请分析作业风险并给出防护措施清单。' },
    ]).onConflictDoNothing();

    this.logger.log(`初始化完成。管理员账号：admin，初始密码：${adminPwd}（首次登录需修改）。`);
  }

  // 保证 admin 账号始终存在且可用：
  // - 不存在则创建（默认密码、免强制改密）
  // - 已存在则不做任何改动（管理员在界面改过的密码不会被覆盖，避免“每次重启还原默认密码”的后门）
  private async ensureAdmin() {
    const adminPwd = process.env.ADMIN_PASSWORD || 'Admin@123456';
    const [adminRole] = await this.db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.key, 'admin'))
      .limit(1);
    if (!adminRole) return;
    const [existing] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, 'admin'))
      .limit(1);
    if (existing) return; // 已存在：尊重现有密码，绝不覆盖
    const wantHash = await this.auth.hash(adminPwd);
    const [admin] = await this.db
      .insert(schema.users)
      .values({
        username: 'admin',
        name: '系统管理员',
        passwordHash: wantHash,
        department: '安全环保部',
        status: 'active',
        mustChangePassword: false,
      })
      .returning({ id: schema.users.id });
    await this.db.insert(schema.userRoles).values({ userId: admin.id, roleId: adminRole.id });
    this.logger.log(`已创建管理员账号 admin / ${adminPwd}（首次登录请修改密码）。`);
  }

  // ============ 演示数据（模拟测试）============
  private async getConfig(key: string): Promise<string | null> {
    const [row] = await this.db
      .select({ value: schema.systemConfig.value })
      .from(schema.systemConfig)
      .where(eq(schema.systemConfig.key, key))
      .limit(1);
    return row?.value ?? null;
  }

  private async setConfig(key: string, value: string) {
    await this.db
      .insert(schema.systemConfig)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.systemConfig.key, set: { value, updatedAt: new Date() } });
  }

  private async clearDemo() {
    const raw = await this.getConfig(DEMO_IDS);
    let ids: any = {};
    if (raw) {
      try {
        ids = JSON.parse(raw);
      } catch {
        ids = {};
      }
    }
    const del = async (table: any, col: any, arr: any[]) => {
      if (Array.isArray(arr) && arr.length) await this.db.delete(table).where(inArray(col, arr));
    };
    // 全流程演示（先清子表，再主单，最后培训记录）
    await del(schema.inspectionRecords, schema.inspectionRecords.id, ids.inspections);
    await del(schema.safetyBriefings, schema.safetyBriefings.id, ids.briefings);
    await del(schema.workPermits, schema.workPermits.id, ids.appWorkPermits);
    await del(schema.workPermits, schema.workPermits.id, ids.applications);
    await del(schema.workPermitTrainings, schema.workPermitTrainings.id, ids.appTrainings);
    await del(schema.workPermitChecks, schema.workPermitChecks.id, ids.checks);
    await del(schema.workPermits, schema.workPermits.id, ids.workPermits);
    await del(schema.hazards, schema.hazards.id, ids.hazards);
    await del(schema.userRoles, schema.userRoles.userId, ids.users);
    await del(schema.departmentManagers, schema.departmentManagers.userId, ids.users);
    await del(schema.users, schema.users.id, ids.users);
    await del(schema.departments, schema.departments.id, ids.departments);
    await del(schema.areas, schema.areas.id, ids.areas);
    await del(schema.qrCodes, schema.qrCodes.id, ids.qrCodes);
    // 兜底：强制重置时清空所有演示相关表（包括同步/失败遗留的孤儿记录），避免编号冲突与未关联脏数据
    await this.db.delete(schema.inspectionRecords);
    await this.db.delete(schema.safetyBriefings);
    await this.db.delete(schema.workPermitChecks);
    await this.db.delete(schema.workPermits);
    await this.db.delete(schema.workPermitTrainings);
    await this.db.delete(schema.hazards);
    await this.db.delete(schema.qrCodes);
    await this.db.delete(schema.systemConfig).where(inArray(schema.systemConfig.key, [DEMO_SEEDED, DEMO_IDS]));
  }

  // 根据数据库中已有作业票编号，初始化 seedPermitNo 各前缀计数器，防止编号冲突
  private async initSeedSeqFromDb() {
    const rows = await this.db.select({ permitNo: schema.workPermits.permitNo }).from(schema.workPermits);
    for (const { permitNo } of rows) {
      if (!permitNo) continue;
      const m = permitNo.match(/^([A-Z]+)-\d{6}-(\d{4})$/);
      if (!m) continue;
      const prefix = m[1];
      const seq = parseInt(m[2], 10);
      const current = _seedSeqByPrefix.get(prefix) || 0;
      if (seq > current) _seedSeqByPrefix.set(prefix, seq);
    }
  }

  async seedDemo(force = false) {
    if (force) {
      this.logger.log('清除已有演示数据……');
      await this.clearDemo();
    } else if (await this.getConfig(DEMO_SEEDED)) {
      this.logger.log('演示数据已存在，跳过（如需重置请设置 SEED_DEMO_FORCE=1）。');
      return;
    }

    // 初始化编号计数器：避免演示数据生成时与已存在的作业票编号冲突
    await this.initSeedSeqFromDb();

    this.logger.log('开始生成演示数据（模拟测试用）……');

    // 部门（幂等：已存在则跳过，再统一查询构建映射，避免重复键中断启动）
    await this.db.insert(schema.departments).values(DEPARTMENTS).onConflictDoNothing();
    const deptAll = await this.db
      .select({ id: schema.departments.id, name: schema.departments.name })
      .from(schema.departments);
    const deptIdByName = new Map(deptAll.map((d) => [d.name, d.id]));

    // 区域（幂等）
    await this.db.insert(schema.areas).values(AREAS).onConflictDoNothing();
    const areaAll = await this.db
      .select({ id: schema.areas.id, name: schema.areas.name })
      .from(schema.areas);
    const areaIdByName = new Map(areaAll.map((a) => [a.name, a.id]));

    // 角色映射
    const roleRows = await this.db.select({ id: schema.roles.id, key: schema.roles.key }).from(schema.roles);
    const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]));

    // 用户（幂等：已存在则跳过，再统一查询补全映射）
    const pwdHash = await this.auth.hash(DEMO_PWD);
    const userVals = USERS.map((u) => ({
      username: u.username,
      name: u.name,
      passwordHash: pwdHash,
      email: u.email,
      phone: u.phone,
      department: u.department,
      area: mapArea(u.area),
      status: 'active',
      mustChangePassword: false,
    }));
    await this.db.insert(schema.users).values(userVals).onConflictDoNothing();

    // 模拟员工数据（普通员工/安全员/审批人，演示“部门/员工”管理页）
    const empVals = EMPLOYEES.map((u) => ({
      username: u.username,
      name: u.name,
      passwordHash: pwdHash,
      email: u.email,
      phone: u.phone,
      department: u.department,
      area: mapArea(u.area),
      status: 'active',
      mustChangePassword: false,
    }));
    await this.db.insert(schema.users).values(empVals).onConflictDoNothing();

    // 统一查询全部演示用户 id，构建映射（含已存在/本次新增），用于后续关联与清档
    const allDemoUsernames = [...USERS, ...EMPLOYEES].map((u) => u.username);
    const userAll = await this.db
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(inArray(schema.users.username, allDemoUsernames));
    const userIdByName = new Map(userAll.map((u) => [u.username, u.id]));
    const userRows = userAll.map((u) => ({ id: u.id, username: u.username }));

    // 用户-角色
    const urVals = [...USERS, ...EMPLOYEES].map((u) => ({ userId: userIdByName.get(u.username)!, roleId: roleIdByKey.get(u.roleKey)! })).filter(
      (v) => v.userId && v.roleId,
    );
    await this.db.insert(schema.userRoles).values(urVals).onConflictDoNothing();

    // 部门负责人（approver 关联到其所在部门）
    const dmVals = [...USERS, ...EMPLOYEES].filter((u) => u.roleKey === 'approver')
      .map((u) => ({ userId: userIdByName.get(u.username)!, departmentId: deptIdByName.get(u.department)! }))
      .filter((v) => v.userId && v.departmentId);
    await this.db.insert(schema.departmentManagers).values(dmVals).onConflictDoNothing();

    // 隐患（批量生成 250 条，状态随机停留于不同节点，覆盖看板与统计各态）
    const HZ_STATUS_POOL = ['pending_assign', 'assigned', 'rectified', 'dept_confirmed', 'accepted', 'rejected', 'cancelled'];
    const hzVals: any[] = [];
    const HZ_COUNT = 250;
    for (let i = 0; i < HZ_COUNT; i++) {
      const base = HAZARDS[i % HAZARDS.length];
      const daysAgo = 1 + ((i * 7) % 60); // 1..60 天内分布
      const status = HZ_STATUS_POOL[rnd(HZ_STATUS_POOL.length)]; // 随机停留节点
      hzVals.push(buildHazard({ ...base, daysAgo, status }, i, userIdByName));
    }
    const hzRows = await this.db.insert(schema.hazards).values(hzVals).returning({ id: schema.hazards.id });

    // 作业票（纸质演示票默认跳过，SEED_DEMO_APPS=1 恢复；保持与作业票申请一一对应）
    const wpRows: { id: string }[] = [];
    if (process.env.SEED_DEMO_APPS === '1') {
      for (let i = 0; i < WORK_PERMITS.length; i++) {
        const w = WORK_PERMITS[i];
        const base = buildWp(w, i, userIdByName);
        base.channel = 'electronic';
        let routineWp: { id: string; permitNo: string } | null = null;
        if (base.isHazardous) {
          const [rw] = await this.db
            .insert(schema.workPermits)
            .values({
              permitNo: seedPermitNo('routine'),
              channel: 'electronic',
              type: 'routine',
              isHazardous: false,
              area: base.area,
              location: base.location,
              startTime: base.startTime,
              endTime: base.endTime,
              applicantId: base.applicantId,
              applicantName: base.applicantName,
              department: base.department,
              operatorNames: base.operatorNames,
              supervisorName: base.supervisorName,
              content: base.content,
              status: 'approved',
              riskLevel: 'low',
              createdAt: base.createdAt,
              updatedAt: base.updatedAt,
            })
            .returning({ id: schema.workPermits.id, permitNo: schema.workPermits.permitNo });
          routineWp = rw;
        }
        if (routineWp) {
          base.linkedRoutineId = routineWp.id;
          base.linkedRoutineNo = routineWp.permitNo;
        }
        const [wp] = await this.db.insert(schema.workPermits).values(base).returning({ id: schema.workPermits.id });
        wpRows.push(wp);
      }
    }

    // 二维码（使用 PUBLIC_BASE_URL 环境变量，生产环境需配置）
    const baseUrl = appBaseUrl();
    const qrVals = QR_CODES.map((q) => ({
      name: q.name,
      scene: q.scene,
      area: mapArea(q.area),
      targetUrl: `${baseUrl}/anonymous?area=${encodeURIComponent(q.area)}`,
      enabled: true,
    }));
    const qrRows = await this.db.insert(schema.qrCodes).values(qrVals).returning({ id: schema.qrCodes.id });

    // 现场检查记录（依附纸质票，随 SEED_DEMO_APPS 开关）
    const chkRows: { id: string }[] = [];
    if (process.env.SEED_DEMO_APPS === '1') {
      const chkVals = CHECKS.map((c) => ({
        workPermitId: wpRows[c.wp].id,
        checkerName: c.checker,
        checkItems: c.items,
        note: c.note,
        checkedAt: addDays(new Date(), -c.days),
      }));
      chkRows.push(...(await this.db.insert(schema.workPermitChecks).values(chkVals).returning({ id: schema.workPermitChecks.id })));
    }

    // ============ 作业申请单全流程演示（现场移动端 / 看板 / 统计）============
    const appIds: string[] = [];
    const appTrainingIds: string[] = [];
    const appWpIds: string[] = [];
    const appBriefingIds: string[] = [];
    const appInspIds: string[] = [];
    let wpSeq = 0;

    // 【2026-08】作业票演示数据默认关闭（SEED_DEMO_APPS=1 恢复，变量名沿用历史命名）：
    // 单表合并后已无"申请单/作业票两表"，此处直接插 work_permits；
    // 真实作业票数据由 simulate_v3.py 全流程 API 模拟生成。
    if (process.env.SEED_DEMO_APPS === '1') {
    for (const a of APPLICATIONS) {
      const applicantId = userIdByName.get(a.applicant) ?? null;
      const reviewerId = a.reviewer ? userIdByName.get(a.reviewer) ?? null : null;
      const approverId = a.approver ? userIdByName.get(a.approver) ?? null : null;
      const planStart = planStartAt(a.planFrom);
      const planEnd = addDays(planStart, a.planDur);
      const isExec = a.status === 'printed' || a.status === 'paused' || a.status === 'finished' || a.status === 'completed';
      const createdAt = daysAgo(Math.max(1, -a.planFrom + 1));
      const projectName = `${a.dept}·${a.area}检维修项目`;
      const seedNum = Number(String(a.permitNo).replace(/\D/g, '')) || 0;
      const contractorPhone = '138' + String(10000000 + (seedNum * 7919 % 90000000));
      const hazardLabels = (a.hazTypes || []).map((t: string) => HAZARD_LABELS[t] || t);
      const managementPerson = a.approver ? userName(a.approver) : a.supervisor;

      // 主单：直接建为常规作业票（GWP），不再有独立的作业申请单（方案 B 单表合并）
      const patch: any = {
        permitNo: a.permitNo,
        type: 'routine',
        channel: 'electronic',
        applicantId,
        applicantName: userName(a.applicant),
        department: a.dept,
        area: mapArea(a.area),
        location: a.location,
        jobName: a.jobName,
        projectName,
        content: a.content,
        startTime: planStart,
        endTime: planEnd,
        operatorNames: a.operators as any,
        supervisorName: a.supervisor,
        contractorUnit: a.contractor,
        contractorHead: CONTRACTOR_HEAD[a.contractor] || a.supervisor,
        contractorPhone,
        managementDept: a.dept,
        managementPerson,
        hazardTypeList: hazardLabels as any,
        status: a.status,
        reviewerId,
        reviewerName: a.reviewer ? userName(a.reviewer) : null,
        reviewOpinion: '安全措施与作业方案审核合格，同意进入下一环节。',
        reviewedAt: createdAt,
        approverId,
        approverName: a.approver ? userName(a.approver) : null,
        approvalOpinion: a.approver ? '批准作业，须严格执行作业票安全措施。' : null,
        approvedAt: a.approver ? createdAt : null,
        printCount: a.printCount ?? (isExec ? 1 : 0),
        createdAt,
        updatedAt: new Date(),
      };
      if (isExec) patch.printedAt = planStart;
      if (a.status === 'paused') {
        patch.pausedAt = hoursAgo(3);
        patch.pausedBy = a.pausedBy ? userIdByName.get(a.pausedBy) ?? null : null;
        patch.pausedByName = a.pausedBy ? userName(a.pausedBy) : null;
        patch.pauseReason = a.pauseReason ?? null;
      }
      if (a.status === 'finished') patch.finishedAt = hoursAgo(24);
      if (a.status === 'completed') {
        patch.finishedAt = daysAgo(4);
        patch.archivedAt = daysAgo(3);
      }
      const [app] = await this.db.insert(schema.workPermits).values(patch).returning({ id: schema.workPermits.id });
      appIds.push(app.id);

      // 承包商安全培训记录（直接挂常规作业票）
      const traineeSigs = a.trainees.map((n) => ({ name: n, signed: true, signImg: sigImg(n), signedAt: hoursAgo(6) }));
      const [training] = await this.db
        .insert(schema.workPermitTrainings)
        .values({
          workPermitId: app.id,
          trainer: a.trainer,
          trainingTopics: `${a.jobName} 作业安全交底与承包商入场培训：作业风险辨识、个人防护、应急处置、作业许可要求。`,
          traineeNames: a.trainees as any,
          traineeSignatures: traineeSigs as any,
          trainingDate: hoursAgo(7),
          testResult: '合格',
          remark: `承包商：${a.contractor}`,
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: schema.workPermitTrainings.id });
      appTrainingIds.push(training.id);

      // 为含危险作业的申请单创建一张对应常规票（GWP），作为后续危险票的挂靠父单
      // 【方案 B】主单本身已是常规票，危险票直接挂靠主单（app.id）。

      // 关联危险作业票（随主单状态推进）
      // 关联危险作业票状态随主单节点推进（保持一致，避免“草稿父单却挂着已批准作业票”）
      let wpStatus: string;
      if (isExec) wpStatus = a.status;
      else if (a.status === 'approved') wpStatus = 'approved';
      else if (a.status === 'voided') wpStatus = 'voided';
      else if (['pending_review', 'ehs_reviewing', 'reviewing'].includes(a.status as string)) wpStatus = a.status;
      else wpStatus = 'draft';
      for (const t of a.hazTypes) {
        wpSeq += 1;
        // 临时用电危险作业票有效期 ≤15 天（跨日），其余危险作业票为当日（≤24h）
        const wpStart = planStart;
        const wpEnd = t === 'temporary_electricity' ? addDays(planStart, 1 + rnd(12)) : planEnd;
        const wpPatch: any = {
          permitNo: seedPermitNo(t, wpSeq),
          channel: 'electronic',
          type: t,
          isHazardous: true,
          riskLevel: evaluateRiskLevel({ type: t, isHazardous: true, startTime: wpStart, endTime: wpEnd }),
          area: mapArea(a.area),
          location: a.location,
          startTime: wpStart,
          endTime: wpEnd,
          applicantId,
          applicantName: userName(a.applicant),
          department: a.dept,
          operatorNames: a.operators as any,
          supervisorName: a.supervisor,
          content: a.content,
          safetyMeasures: [] as any,
          linkedRoutineId: app.id,
          linkedRoutineNo: a.permitNo,
          status: wpStatus,
          reviewerId,
          reviewerName: a.reviewer ? userName(a.reviewer) : null,
          approverId,
          approverName: a.approver ? userName(a.approver) : null,
          printCount: a.printCount ?? (isExec ? 1 : 0),
          signatures: isExec
            ? [
                { name: a.supervisor, role: 'supervisor', signImg: sigImg(a.supervisor), signedAt: hoursAgo(6) },
                { name: a.operators[0], role: 'worker', signImg: sigImg(a.operators[0]), signedAt: hoursAgo(6) },
              ]
            : ([] as any),
          createdAt,
          updatedAt: new Date(),
        };
        if (isExec) {
          wpPatch.printedAt = planStart;
          // 执行态（已打印/暂停/已完工）必须有 6 位作业代码，门卫扫码入场登记依赖它
          wpPatch.workCode = String(300000 + wpSeq);
          wpPatch.trainingQrToken = randomUUID();
          wpPatch.trainingQrExpiresAt = addDays(planStart, 3);
        }
        if (a.status === 'finished' || a.status === 'completed') wpPatch.finishedAt = patch.finishedAt;
        const [wp] = await this.db.insert(schema.workPermits).values(wpPatch).returning({ id: schema.workPermits.id });
        appWpIds.push(wp.id);
      }

      // 安全交底：自动带出申请单第3步预设清单（现场逐条勾选）；仅承包商负责人签字，无需管理部门
      if (a.briefing !== 'none') {
        const done = a.briefing === 'done';
        // 按申请单第3步预设（buildBriefingTemplate）带出，done 时全部勾选确认
        const points = buildBriefingTemplate().map((g) => ({
          key: g.key,
          title: g.title,
          mode: g.mode,
          items: (g.items || []).map((it) =>
            g.mode === 'choice'
              ? { text: it.text, status: done ? 'normal' : undefined }
              : { text: it.text, checked: done },
          ),
        }));
        const briefSigs = done
          ? [{ name: `${a.contractor}·现场负责人`, role: 'contractor', signImg: sigImg('承包商'), signedAt: hoursAgo(6) }]
          : [];
        const [bf] = await this.db
          .insert(schema.safetyBriefings)
          .values({
            workPermitId: app.id,
            briefer: a.trainer,
            points: points as any,
            aiDraft: null, // AI 草稿已移除
            content: done ? `现场已按申请单第3步预设逐项交底并确认。补充说明：${a.briefPoints.join('；')}` : null,
            photos: [] as any,
            signatures: briefSigs as any,
            briefedAt: done ? hoursAgo(6) : null,
            status: done ? 'done' : 'draft',
            createdAt,
            updatedAt: new Date(),
          })
          .returning({ id: schema.safetyBriefings.id });
        appBriefingIds.push(bf.id);
      }

      // 巡检记录
      for (const ins of a.inspections) {
        const [ir] = await this.db
          .insert(schema.inspectionRecords)
          .values({
            workPermitId: app.id,
            inspectedAt: hoursAgo(ins.hoursAgo),
            inspector: ins.inspector,
            result: ins.result,
            note: ins.note,
            source: ins.source ?? 'manual',
            ocrRaw: ins.source === 'ocr' ? `巡检人：${ins.inspector}\n结果：正常\n${ins.note}` : null,
            createdBy: ins.inspector,
            createdAt: hoursAgo(ins.hoursAgo),
          })
          .returning({ id: schema.inspectionRecords.id });
        appInspIds.push(ir.id);
      }
    }
    } // SEED_DEMO_APPS 申请单/票演示数据

    // 记录标记，便于幂等/重置
    await this.setConfig(DEMO_SEEDED, '1');
    await this.setConfig(
      DEMO_IDS,
      JSON.stringify({
        departments: deptAll.map((d) => d.id),
        areas: areaAll.map((a) => a.id),
        users: userRows.map((u) => u.id),
        hazards: hzRows.map((h) => h.id),
        workPermits: wpRows.map((w) => w.id),
        qrCodes: qrRows.map((q) => q.id),
        checks: chkRows.map((c) => c.id),
        applications: appIds,
        appTrainings: appTrainingIds,
        appWorkPermits: appWpIds,
        briefings: appBriefingIds,
        inspections: appInspIds,
      }),
    );

    this.logger.log(
      `演示数据生成完成：部门 ${deptAll.length}、区域 ${areaAll.length}、用户 ${userRows.length}、隐患 ${hzRows.length}、作业票 ${wpRows.length}、二维码 ${qrRows.length}。演示账号密码均为 ${DEMO_PWD}。`,
    );
  }

  /**
   * 模拟常规作业票完整作业过程（受 SEED_SIM_ROUTINE 数量控制，幂等）。
   * 每张常规票包含：作业申请单(JSA) + 常规作业票(GWP) + 承包商培训记录
   * + 现场安全交底 + 作业人员入厂登记，并分布到不同状态。
   */
  async simulateRoutineWorkflow() {
    const n = parseInt(process.env.SEED_SIM_ROUTINE || '0', 10);
    if (!n || n <= 0) return;
    const logger = this.logger;
    const SIM = 'SIM_ROUTINE';
    // 初始化编号计数器，避免与已有作业票编号冲突（普通启动不会走 clearDemo）
    await this.initSeedSeqFromDb();
    logger.log(`[sim] 开始模拟 ${n} 张常规作业票（含 JSA / 交底 / 入厂记录）...`);

    // ---- 幂等清理上次模拟 ----
    const prev = await this.db.select({ id: schema.workPermits.id })
      .from(schema.workPermits)
      .where(eq(schema.workPermits.projectName, SIM));
    const prevIds = prev.map((p) => p.id);
    if (prevIds.length) {
      await this.db.delete(schema.entryRegistrations)
        .where(inArray(schema.entryRegistrations.workPermitId, prevIds));
      await this.db.delete(schema.safetyBriefings)
        .where(inArray(schema.safetyBriefings.workPermitId, prevIds));
      await this.db.delete(schema.workPermitTrainings)
        .where(inArray(schema.workPermitTrainings.workPermitId, prevIds));
      await this.db.delete(schema.workPermits)
        .where(inArray(schema.workPermits.id, prevIds));
      logger.log(`[sim] 已清理上次模拟 ${prevIds.length} 条`);
    }

    // ---- 基础数据池 ----
    const users = await this.db.select({
      id: schema.users.id, name: schema.users.name, department: schema.users.department,
    }).from(schema.users);
    const pick = <T>(arr: T[]): T => arr[rnd(arr.length)];
    const applicant = pick(users);
    const others = users.filter((u) => u.id !== applicant.id);
    const reviewer = pick(others.length ? others : users);
    const approverPool = others.filter((u) => u.id !== reviewer.id);
    const approver = pick(approverPool.length ? approverPool : users);

    const JOBS = [
      '车间地面警示线涂刷', '配电箱定期检查维护', '通风管道清洗', '设备润滑油更换',
      '消防通道杂物清理', '照明灯具更换', '地面防滑处理', '货架标识更新',
      '排水沟清理', '监控摄像头调试', '反应釜外壁除锈防腐', '输送带张紧调整',
      '应急照明测试', '地坪裂缝修补', '阀门井清淤', '桥架线缆整理',
      '冷却塔填料更换', '空压机滤芯更换',
    ];
    const WORKERS = ['张强', '李娜', '王磊', '刘洋', '陈静', '杨帆', '赵磊', '孙丽', '周涛', '吴敏', '郑伟', '冯刚', '蒋勇', '韩雪', '沈浩', '朱琳'];
    const DEPTS = ['生产部', '设备动力部', '安全环保部', '仓储部', '质量管理部', '行政部'];
    const AREAS = [
      { building: '1号厂房', floor: '1层', area: 'A区', location: 'A区灌装线旁' },
      { building: '1号厂房', floor: '2层', area: 'B区', location: 'B区配电室' },
      { building: '2号厂房', floor: '1层', area: 'C区', location: 'C区原料库' },
      { building: '动力站', floor: '1层', area: 'D区', location: 'D区空压机房' },
      { building: '罐区', floor: '室外', area: 'E区', location: 'E区储罐区' },
    ];
    const GATES = ['1号门(人行)', '2号门(车行)', '3号门(物流)', '东门岗'];
    const CONTRACTORS = ['华兴设备安装有限公司', '安信防腐工程队', '精工机电维修部', '宏达保洁服务公司', '迅捷脚手架租赁站'];
    const MEASURES = [
      '作业前开展 JSA 安全分析，确认风险控制措施到位',
      '正确佩戴安全帽、防护手套、安全带等个人防护用品',
      '设置警戒隔离区并安排专人监护',
      '执行上锁挂牌（LOTO）程序，断电检修',
      '现场配备适用的消防器材',
      '保持通道畅通，作业完毕及时清理现场',
    ];
    const buildJsa = (job: string) => ([
      { step: '作业准备', hazard: '未辨识现场风险即开工', control: '作业前开展 JSA 分析，确认安全措施与监护人到位', risk: '低' },
      { step: '现场作业', hazard: '机械伤害 / 触电 / 高处坠落', control: '佩戴防护用品，执行上锁挂牌，使用检验合格工具', risk: '中' },
      { step: '收尾验收', hazard: '杂物遗留、防护恢复不到位', control: '作业完毕清理现场，恢复安全设施，填写完工记录', risk: '低' },
    ]);
    const idCard = () => {
      const region = pick(['110101', '330102', '440106', '510107', '320106']);
      const y = 1970 + rnd(30);
      const md = 1000 + rnd(8999);
      const seq = 100 + rnd(899);
      return `${region}${y}${md}${seq}${pick(['X', '1', '2', '3', '4', '5', '6', '7', '8', '9'])}`;
    };
    const ageFor = (s: string): number => {
      switch (s) {
        case 'draft': return rnd(2);
        case 'pending_review': return 1 + rnd(2);
        case 'approved': return 2 + rnd(3);
        case 'printed': return 1 + rnd(3);
        case 'paused': return 3 + rnd(3);
        case 'finished': return 4 + rnd(4);
        case 'completed': return 7 + rnd(8);
        case 'rejected': return 2 + rnd(3);
        case 'voided': return 3 + rnd(4);
        default: return rnd(5);
      }
    };

    // 状态分布（合计 30）：草稿 / 待审 / 已批准 / 执行中 / 已暂停 / 完工 / 已归档 / 已驳回 / 已作废
    const planTemplate = [
      'draft', 'draft', 'draft',
      'pending_review', 'pending_review', 'pending_review', 'pending_review',
      'approved', 'approved', 'approved', 'approved',
      'printed', 'printed', 'printed', 'printed', 'printed',
      'paused', 'paused', 'paused',
      'finished', 'finished', 'finished',
      'completed', 'completed', 'completed', 'completed',
      'rejected', 'rejected',
      'voided', 'voided',
    ];
    const plan: string[] = [];
    for (let i = 0; i < n; i++) plan.push(planTemplate[i % planTemplate.length]);

    const ym = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    let appSeq = 0;
    let created = 0;

    for (let i = 0; i < n; i++) {
      const status = plan[i];
      const job = JOBS[i % JOBS.length];
      const dept = applicant.department || pick(DEPTS);
      const ar = pick(AREAS);
      const opCount = 1 + rnd(3);
      const operators: string[] = [];
      for (let k = 0; k < opCount; k++) operators.push(pick(WORKERS));
      const supervisor = pick(WORKERS);
      const ageDays = ageFor(status);
      const createdAt = daysAgo(ageDays + rnd(3));
      // 作业看板(board/today)仅展示 printed/paused/finished 且计划时段与“今天”重叠的常规票。
      // 这三类必须把 planStart/planEnd（及作业票 startTime/endTime）锚定到今天附近，否则看板一个都看不到。
      const boardVisible = ['printed', 'paused', 'finished'].includes(status);
      const planStart = boardVisible ? addDays(new Date(), -1) : addDays(createdAt, 1);
      const planEnd = boardVisible ? addDays(new Date(), 2) : addDays(planStart, rnd(3) + 1);
      const jsas = buildJsa(job);
      const content = `${job}。需严格执行作业许可制度与各项安全措施，作业前完成 JSA 分析与安全交底。`;

      const appVals: any = {
        permitNo: `SIM-${ym}-${String(++appSeq).padStart(4, '0')}`,
        channel: 'electronic',
        applicantId: applicant.id, applicantName: applicant.name, department: dept,
        building: ar.building, floor: ar.floor, area: ar.area, location: ar.location,
        jobName: job, content,
        planStart, planEnd, operatorNames: operators,
        supervisorName: supervisor, supervisorContact: '138' + String(rnd(100000000)).padStart(8, '0').slice(0, 8),
        permitType: 'routine', type: 'routine',
        jsas, involvesHazardous: false,
        safetyMeasures: MEASURES.map((m, idx) => ({ id: 'M' + (idx + 1), content: m, checked: true })),
        expectedOperatorCount: operators.length,
        status, projectName: SIM,
        createdAt, updatedAt: new Date(),
      };
      const wpVals: any = {
        permitNo: seedPermitNo('routine'),
        channel: 'electronic', type: 'routine', isHazardous: false,
        area: ar.area, location: ar.location,
        startTime: planStart, endTime: planEnd,
        applicantId: applicant.id, applicantName: applicant.name,
        department: dept, operatorNames: operators,
        expectedOperatorCount: operators.length,
        supervisorName: supervisor, content,
        riskLevel: 'low', safetyMeasures: MEASURES, jsas,
        status, createdAt, updatedAt: new Date(),
      };

      // 审批 / 执行时间线
      if (['approved', 'printed', 'paused', 'finished', 'completed'].includes(status)) {
        const reviewedAt = addDays(createdAt, 1);
        const approvedAt = addDays(createdAt, 1);
        Object.assign(appVals, {
          reviewerId: reviewer.id, reviewerName: reviewer.name,
          reviewOpinion: '作业方案与安全措施审核合格，同意进入下一环节。', reviewedAt,
          approverId: approver.id, approverName: approver.name,
          approvalOpinion: '批准作业，须严格执行作业票安全措施。', approvedAt,
        });
        Object.assign(wpVals, {
          reviewerId: reviewer.id, reviewerName: reviewer.name,
          reviewOpinion: appVals.reviewOpinion, reviewedAt,
          approverId: approver.id, approverName: approver.name,
          approvalOpinion: appVals.approvalOpinion, approvedAt,
        });
      } else if (status === 'rejected') {
        const reviewedAt = addDays(createdAt, 1);
        Object.assign(appVals, {
          reviewerId: reviewer.id, reviewerName: reviewer.name,
          reviewOpinion: '作业风险辨识不充分，安全措施不到位，不予批准。', reviewedAt,
        });
        Object.assign(wpVals, {
          reviewerId: reviewer.id, reviewerName: reviewer.name,
          reviewOpinion: appVals.reviewOpinion, reviewedAt,
        });
      }
      if (['printed', 'paused', 'finished', 'completed'].includes(status)) {
        const printedAt = addDays(createdAt, 2);
        Object.assign(appVals, { printedAt });
        Object.assign(wpVals, {
          printedAt, printCount: 1,
          workCode: String(300000 + i + 1),
          trainingQrToken: randomUUID(), trainingQrExpiresAt: addDays(printedAt, 3),
          signatures: [
            { role: 'supervisor', name: supervisor, signImg: sigImg(supervisor), signedAt: printedAt },
            { role: 'worker', name: operators[0], signImg: sigImg(operators[0]), signedAt: printedAt },
          ],
        });
      }
      if (status === 'paused') {
        const pausedAt = addDays(createdAt, 3);
        Object.assign(appVals, { pausedAt, pausedByName: approver.name, pauseReason: '现场气象条件不满足作业要求，暂停作业。' });
        Object.assign(wpVals, { pausedAt, pausedByName: approver.name, pausedReason: appVals.pauseReason });
      }
      if (['finished', 'completed'].includes(status)) {
        const finishedAt = addDays(createdAt, 4);
        Object.assign(appVals, { finishedAt });
        Object.assign(wpVals, { finishedAt });
      }
      if (status === 'completed') {
        const archivedAt = addDays(createdAt, 5);
        Object.assign(appVals, { archivedAt });
        Object.assign(wpVals, { archivedAt });
      }
      if (status === 'voided') {
        const voidedAt = addDays(createdAt, 2);
        Object.assign(appVals, { voidedAt, voidedByName: approver.name, voidReason: '作业计划取消，作废旧票。' });
        Object.assign(wpVals, { voidedAt, voidedByName: approver.name, voidReason: appVals.voidReason });
      }

      const [wp] = await this.db.insert(schema.workPermits).values(wpVals).returning({ id: schema.workPermits.id });

      // 承包商入场培训
      let trainingId: string | null = null;
      if (['approved', 'printed', 'paused', 'finished', 'completed'].includes(status)) {
        const [tr] = await this.db.insert(schema.workPermitTrainings).values({
          workPermitId: wp.id, trainer: supervisor,
          trainingTopics: `${job} 作业安全交底与承包商入场培训：风险辨识、个人防护、应急处置、作业许可要求。`,
          traineeNames: operators,
          traineeSignatures: operators.map((o) => ({ name: o, signed: true, signImg: sigImg(o), signedAt: addDays(createdAt, 1) })),
          trainingDate: addDays(createdAt, 1), testResult: '合格',
          remark: `承包商：${pick(CONTRACTORS)}`, createdAt, updatedAt: new Date(),
        } as any).returning({ id: schema.workPermitTrainings.id });
        trainingId = tr.id;
      }

      // 现场安全交底
      if (['approved', 'printed', 'paused', 'finished', 'completed'].includes(status)) {
        const done = ['printed', 'paused', 'finished', 'completed'].includes(status);
        const points = buildBriefingTemplate().map((g) => ({
          key: g.key, title: g.title, mode: g.mode,
          items: (g.items || []).map((it: any) =>
            g.mode === 'choice' ? { text: it.text, status: done ? 'normal' : undefined } : { text: it.text, checked: done }),
        }));
        const briefSigs = done
          ? [{ name: `${pick(CONTRACTORS)}·现场负责人`, role: 'contractor', signImg: sigImg('承包商'), signedAt: addDays(createdAt, 2) }]
          : [];
        await this.db.insert(schema.safetyBriefings).values({
          workPermitId: wp.id, briefer: supervisor,
          points: points as any, aiDraft: null,
          content: done ? '现场已按申请单第3步逐项交底并确认。' : null,
          photos: [], signatures: briefSigs,
          briefedAt: done ? addDays(createdAt, 2) : null,
          status: done ? 'done' : 'draft', createdAt, updatedAt: new Date(),
        });
      }

      // 作业人员入厂登记
      if (['printed', 'paused', 'finished', 'completed'].includes(status)) {
        const printedAt = wpVals.printedAt;
        for (const op of operators) {
          const signOutAt = (status === 'finished' || status === 'completed') ? addDays(printedAt, 1 + rnd(2)) : null;
          await this.db.insert(schema.entryRegistrations).values({
            workPermitId: wp.id,
            contractorUnit: pick(CONTRACTORS), workerName: op,
            workerIdCard: idCard(), workerPhone: '1' + pick(['3', '5', '7', '8']) + String(rnd(100000000)).padStart(8, '0'),
            trainingPassed: true, trainingRecordId: trainingId, signImg: sigImg(op),
            gate: pick(GATES), registeredAt: printedAt, signOutAt,
            createdAt,
          });
        }
      }

      created++;
    }
    logger.log(`[sim] 模拟完成，新增 ${created} 张常规作业票（含培训 / 交底 / 入厂记录）。`);
  }
}
