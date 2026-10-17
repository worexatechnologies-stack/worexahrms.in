import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useSelector, useDispatch } from 'react-redux'
import Login from './components/Login'
import Layout from './components/Layout'
import { loginSuccess, logoutSuccess, toggleTheme, setSoundEnabled } from './store/authSlice'
import { useGetMeQuery, useUpdateSoundSettingMutation } from './store/apiSlice'
import { playToggleSound } from './utils/audioHelper'
import { notificationService } from './services/notificationService'
import './styles.css'

const HrDashboard = lazy(() => import('./pages/HR/ExecutiveDashboard'))
const Employees = lazy(() => import('./pages/HR/Employees'))
const HrPayroll = lazy(() => import('./pages/HR/Payroll'))
const HrAttendance = lazy(() => import('./pages/HR/Attendance'))
const HrLeaves = lazy(() => import('./pages/HR/LeaveRequests'))
const HrHolidays = lazy(() => import('./pages/HR/Holidays'))
const ActivityLogs = lazy(() => import('./pages/HR/ActivityLogs'))
const DepartmentsPage = lazy(() => import('./pages/HR/Departments'))
const EmpDashboard = lazy(() => import('./pages/Employee/SelfServiceDashboard'))
const EmpAttendance = lazy(() => import('./pages/Employee/Attendance'))
const EmpAttendanceSheet = lazy(() => import('./pages/Employee/AttendanceSheet'))
const EmpLeaves = lazy(() => import('./pages/Employee/Leaves'))
const EmpPayslips = lazy(() => import('./pages/Employee/Payslips'))
const EmpDirectory = lazy(() => import('./pages/Employee/Directory'))

const HrWFH = lazy(() => import('./pages/HR/WFH'))
const EmpWFH = lazy(() => import('./pages/Employee/WFH'))

function PageLoader() {
  return (
    <div className="dashboard-skeleton-page">
      <div className="dashboard-skeleton-card">
        <span className="dashboard-skeleton dashboard-skeleton-title" />
        <span className="dashboard-skeleton dashboard-skeleton-line wide" />
        <span className="dashboard-skeleton dashboard-skeleton-line" />
      </div>
    </div>
  )
}

// Helper hooks wrapping Redux state/dispatch for compatibility
export function useAuth() {
  const dispatch = useDispatch();
  const user = useSelector((state) => state.auth.user);
  const login = (userData) => dispatch(loginSuccess({ user: userData }));
  const logout = () => dispatch(logoutSuccess());
  return { user, login, logout };
}

export function useSound() {
  const dispatch = useDispatch();
  const soundEnabled = useSelector((state) => state.auth.soundEnabled);
  const [updateSoundSetting] = useUpdateSoundSettingMutation();

  const toggleSound = async () => {
    const nextEnabled = !soundEnabled;
    dispatch(setSoundEnabled(nextEnabled));
    if (nextEnabled) playToggleSound();
    try {
      await updateSoundSetting({ sound_enabled: nextEnabled }).unwrap();
    } catch {
      dispatch(setSoundEnabled(soundEnabled));
    }
  };

  return { soundEnabled, toggleSound };
}

const toast = (message, type = 'info', options = {}) => {
  notificationService.notify({ type, message, ...options });
};

export function useToast() {
  return { toast };
}

export function useTheme() {
  const dispatch = useDispatch();
  const theme = useSelector((state) => state.auth.theme);
  const setTheme = () => dispatch(toggleTheme());
  return { theme, setTheme };
}

function ProtectedRoute({ children, checking }) {
  const { user } = useAuth();
  if (checking) return <PageLoader />;
  return user ? children : <Navigate to="/login" replace />;
}

function HrRoutes() {
  const { user } = useAuth();
  const isViyana = user?.company_slug === 'viyana';
  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route index element={<HrDashboard />} />
          <Route path="employees" element={<Employees />} />
          <Route path="payroll" element={<HrPayroll />} />
          <Route path="attendance" element={<HrAttendance />} />
          <Route path="leaves" element={<HrLeaves />} />
          <Route path="holidays" element={isViyana ? <Navigate to="/" replace /> : <HrHolidays />} />
          <Route path="activity-logs" element={<ActivityLogs />} />
          <Route path="wfh" element={<HrWFH />} />
          <Route path="departments" element={isViyana ? <Navigate to="/" replace /> : <DepartmentsPage />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

function EmpRoutes() {
  const { user } = useAuth();
  const isViyana = user?.company_slug === 'viyana';
  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route index element={<EmpDashboard />} />
          <Route path="attendance" element={<EmpAttendance />} />
          <Route path="attendance-sheet" element={<EmpAttendanceSheet />} />
          <Route path="leaves" element={<EmpLeaves />} />
          <Route path="payslips" element={<EmpPayslips />} />
          <Route path="holidays" element={isViyana ? <Navigate to="/" replace /> : <HrHolidays />} />
          <Route path="wfh" element={<EmpWFH />} />
          <Route path="directory" element={<EmpDirectory />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

export default function App() {
  const dispatch = useDispatch();
  const { user } = useAuth();
  const { theme } = useTheme();
  const toasts = useSelector((state) => state.auth.toasts);
  const [apiLoading, setApiLoading] = useState(false);
  // Always revalidate the persisted mobile session after startup. The cached
  // user prevents a refresh flicker, while /me.php remains the source of truth.
  const { data: meData, isLoading: meLoading, isFetching: meFetching, isError: meError, isSuccess: meSuccess } = useGetMeQuery();

  useEffect(() => {
    localStorage.setItem('hrms_theme', theme);
    if (theme === 'dark') {
      document.documentElement.className = 'dark';
    } else {
      document.documentElement.className = '';
    }
  }, [theme]);

  useEffect(() => {
    if (meData?.data) {
      dispatch(loginSuccess({ user: meData.data }));
    } else if (meError) {
      dispatch(logoutSuccess());
    }
  }, [dispatch, meData, meError]);

  useEffect(() => {
    const handleApiLoading = (event) => {
      setApiLoading(Boolean(event.detail?.loading))
    }
    window.addEventListener('hrms-api-loading', handleApiLoading)
    return () => window.removeEventListener('hrms-api-loading', handleApiLoading)
  }, [])

  const checkingAuth = !user && !meSuccess && !meError;

  return (
    <div className={`${apiLoading ? 'api-loading' : ''}`}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/*" element={
          <ProtectedRoute checking={checkingAuth}>
            {user?.role === 'hr' ? <HrRoutes /> : <EmpRoutes />}
          </ProtectedRoute>
        } />
      </Routes>
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
          ))}
        </div>
      )}
    </div>
  );
}
