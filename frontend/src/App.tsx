import React, { Suspense } from "react";
import { lazyWithRetry } from "@/utils/lazyWithRetry";
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';

// S18：页面按路由懒加载拆包，降低首屏大包体积（页面均为 default export，lazy 安全）
const Login = lazyWithRetry(() => import('@/pages/Login'));
const ChangePassword = lazyWithRetry(() => import('@/pages/ChangePassword'));
const Dashboard = lazyWithRetry(() => import('@/pages/Dashboard'));
const HazardsList = lazyWithRetry(() => import('@/pages/Hazards/List'));
const HazardReport = lazyWithRetry(() => import('@/pages/Hazards/Report'));
const HazardDetail = lazyWithRetry(() => import('@/pages/Hazards/Detail'));
const MyHazards = lazyWithRetry(() => import('@/pages/Hazards/My'));
const AcceptanceManagement = lazyWithRetry(() => import('@/pages/Hazards/Acceptance'));
const DepartmentHazards = lazyWithRetry(() => import('@/pages/Hazards/Department'));
const UsersList = lazyWithRetry(() => import('@/pages/Users/List'));
const RolesList = lazyWithRetry(() => import('@/pages/Roles/List'));
const DepartmentsList = lazyWithRetry(() => import('@/pages/Departments/List'));
const Settings = lazyWithRetry(() => import('@/pages/Settings/Settings'));
const AnonymousReport = lazyWithRetry(() => import('@/pages/AnonymousReport'));
const TrainingExam = lazyWithRetry(() => import('@/pages/Training/Exam'));
const TrainingManagement = lazyWithRetry(() => import('@/pages/Training/Management'));
const EntryVerification = lazyWithRetry(() => import('@/pages/Public/EntryVerification'));
const EntryRegister = lazyWithRetry(() => import('@/pages/Public/EntryRegister'));
const EntryCheckIn = lazyWithRetry(() => import('@/pages/EntryCheckIn'));
const EntryRecords = lazyWithRetry(() => import('@/pages/EPermits/EntryRecords'));
const AnnualStats = lazyWithRetry(() => import('@/pages/Stats/Annual'));
// 作业票（移动端优先，与纸质流程零耦合）
const EPermitApply = lazyWithRetry(() => import('@/pages/EPermits/Apply'));
const EApprovalList = lazyWithRetry(() => import('@/pages/EApproval/List'));
const EPermitMy = lazyWithRetry(() => import('@/pages/EPermits/My'));
const EPermitDetail = lazyWithRetry(() => import('@/pages/EPermits/Detail'));
const UnifiedTicketList = lazyWithRetry(() => import('@/pages/EPermits/UnifiedList'));
const EOnsiteList = lazyWithRetry(() => import('@/pages/EOnsite/List'));
const EOnsiteInspections = lazyWithRetry(() => import('@/pages/EOnsite/Inspections'));
const EOnsiteConsole = lazyWithRetry(() => import('@/pages/EOnsite/Console'));
const EBoard = lazyWithRetry(() => import('@/pages/EBoard/Board'));
const MobileBoard = lazyWithRetry(() => import('@/pages/MobileBoard'));
const PublicSign = lazyWithRetry(() => import('@/pages/PublicSign'));
const PublicApproval = lazyWithRetry(() => import('@/pages/Public/Approval'));
const ContractorFill = lazyWithRetry(() => import('@/pages/Public/ContractorFill'));
const WorkerFill = lazyWithRetry(() => import('@/pages/Public/WorkerFill'));

// 作业票申请向导（单表合并后直接开作业票，无申请单层）


export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-muted/30">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/anonymous" element={<AnonymousReport />} />
      <Route path="/training/exam" element={<TrainingExam />} />
      <Route path="/public/entry/:token" element={<EntryVerification />} />
      <Route path="/public/entry-register" element={<EntryRegister />} />
      <Route path="/entry" element={<EntryCheckIn />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="/public/sign/:token" element={<PublicSign />} />
      <Route path="/public/approval/:token" element={<PublicApproval />} />
      <Route path="/public/contractor-fill/:token" element={<ContractorFill />} />
      <Route path="/public/worker-fill/:token" element={<WorkerFill />} />

      <Route
        path="/"
        element={
          <ProtectedRoute requirePerms="dashboard:view">
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/hazards"
        element={
          <ProtectedRoute requirePerms={['hazard:view_all', 'hazard:view_own', 'hazard:view_department']}>
            <Layout>
              <HazardsList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/hazards/report"
        element={
          <ProtectedRoute requirePerms="hazard:create">
            <Layout>
              <HazardReport />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/hazards/my"
        element={
          <ProtectedRoute requirePerms={['hazard:view_own', 'hazard:view_all', 'hazard:view_department']}>
            <Layout>
              <MyHazards />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/hazards/acceptance"
        element={
          <ProtectedRoute requirePerms={['hazard:accept', 'hazard:view_all', 'hazard:view_department']}>
            <Layout>
              <AcceptanceManagement />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/hazards/department"
        element={
          <ProtectedRoute requirePerms={['hazard:view_department', 'hazard:view_all']}>
            <Layout>
              <DepartmentHazards />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/hazards/:id"
        element={
          <ProtectedRoute requirePerms={['hazard:view_all', 'hazard:view_own', 'hazard:view_department']}>
            <Layout>
              <HazardDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* 年度统计 */}
      {/* 作业票申请（单表合并后直接开作业票向导，无申请单层） */}
      <Route
        path="/e-permits/apply"
        element={
          <ProtectedRoute requirePerms={['epermit:create', 'epermit:view_all', 'epermit:view_own']}>
            <Layout>
              <EPermitApply />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/e-permits/apply/:id"
        element={
          <ProtectedRoute requirePerms={['epermit:create', 'epermit:view_all', 'epermit:view_own']}>
            <Layout>
              <EPermitApply />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/e-permits/view/:id"
        element={
          <ProtectedRoute requirePerms={['epermit:view_all', 'epermit:view_own']}>
            <Layout>
              <EPermitDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* 电子票审批工作台（已并入统一审批台 /e-approval，此路由移除） */}
      <Route
        path="/e-approval"
        element={
          <ProtectedRoute requirePerms={['epermit:review', 'epermit:approve', 'epermit:approve_ehs', 'epermit:view_all']}>
            <Layout>
              <EApprovalList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/e-permits/my"
        element={
          <ProtectedRoute requirePerms={['epermit:view_own', 'epermit:view_all']}>
            <Layout>
              <EPermitMy />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/e-permits"
        element={
          <ProtectedRoute requirePerms={['epermit:view_all', 'epermit:view_own']}>
            <Layout>
              <UnifiedTicketList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/e-permits/entry-records"
        element={
          <ProtectedRoute requirePerms={['epermit:view_all', 'epermit:view_own']}>
            <Layout>
              <EntryRecords />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* 常规作业管理：只显示常规作业票（GWP） */}
      <Route
        path="/work-permits"
        element={
          <ProtectedRoute requirePerms={['epermit:view_all', 'epermit:view_own']}>
            <Layout>
              <UnifiedTicketList key="regular" onlyKind="regular" />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* 危险作业管理：只显示危险作业票（HWP/CSE/LFP…），依附常规票 */}
      <Route
        path="/hazard-work-permits"
        element={
          <ProtectedRoute requirePerms={['epermit:view_all', 'epermit:view_own']}>
            <Layout>
              <UnifiedTicketList key="hazard" onlyKind="hazard" />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* 电子现场作业台（移动端分步） */}
      <Route
        path="/e-onsite"
        element={
          <ProtectedRoute requirePerms={['epermit:onsite_check', 'epermit:view_all']}>
            <Layout>
              <EOnsiteList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/e-onsite/inspections"
        element={
          <ProtectedRoute requirePerms={['epermit:onsite_check', 'epermit:view_all']}>
            <Layout>
              <EOnsiteInspections />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/e-onsite/:id"
        element={
          <ProtectedRoute requirePerms={['epermit:onsite_check', 'epermit:view_all']}>
            <Layout>
              <EOnsiteConsole />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* 作业看板（桌面大屏） */}
      <Route
        path="/e-board"
        element={
          <ProtectedRoute>
            <Layout>
              <EBoard />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* 手机端·今日作业看板（仅移动端；桌面访问自动重定向 /e-board） */}
      <Route
        path="/m-board"
        element={
          <ProtectedRoute>
            <Layout>
              <MobileBoard />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* 一级安全培训管理 */}
      <Route
        path="/training"
        element={
          <ProtectedRoute>
            <Layout>
              <TrainingManagement />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* 年度统计 */}
      <Route
        path="/stats/annual"
        element={
          <ProtectedRoute requirePerms="work_permit:view_all">
            <Layout>
              <AnnualStats />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/users"
        element={
          <ProtectedRoute requirePerms="user:manage">
            <Layout>
              <UsersList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/roles"
        element={
          <ProtectedRoute requirePerms="role:manage">
            <Layout>
              <RolesList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/departments"
        element={
          <ProtectedRoute requirePerms="department:manage">
            <Layout>
              <DepartmentsList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute requirePerms="config:manage">
            <Layout>
              <Settings />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
