import { createApi } from '@reduxjs/toolkit/query/react';
import api from '../services/api';

// Custom base query that wraps our existing Axios client to preserve concurrent limit and busy-retry interceptors
const axiosBaseQuery = () => async ({ url, method = 'GET', data, params, headers, responseType }, { signal }) => {
  try {
    // Build config — only include headers if actually provided, so Axios uses its defaults otherwise
    const config = { url, method, params, signal }
    if (responseType) config.responseType = responseType
    // Only attach data if present — avoids sending empty body on GETs
    if (data !== undefined) config.data = data
    // Only attach headers if provided — avoids overriding Axios default/interceptor logic
    if (headers !== undefined) config.headers = headers

    const result = await api(config)
    return { data: result.data }
  } catch (axiosError) {
    const err = axiosError
    return {
      error: {
        status: err.response?.status,
        data: err.response?.data || err.message,
      },
    }
  }
}

export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: axiosBaseQuery(),
  tagTypes: [
    'Dashboard',
    'ActivityLogs',
    'Employees',
    'Departments',
    'Teams',
    'Attendance',
    'Leaves',
    'WFH',
    'WFHLive',
    'Holidays',
    'Payroll',
    'Notifications'
  ],
  endpoints: (builder) => ({
    // ----- Auth & User Profile -----
    getMe: builder.query({
      query: () => ({ url: '/me.php' }),
    }),
    updateSoundSetting: builder.mutation({
      query: (data) => ({ url: '/me.php', method: 'PUT', data }),
    }),
    login: builder.mutation({
      query: (data) => ({ url: '/login.php', method: 'POST', data }),
      invalidatesTags: ['Dashboard', 'Notifications', 'Attendance'],
    }),
    logout: builder.mutation({
      query: () => ({ url: '/logout.php', method: 'POST' }),
      invalidatesTags: ['Dashboard', 'Notifications', 'Attendance', 'Employees', 'Leaves', 'Payroll'],
    }),

    // ----- Dashboard & Logs -----
    getDashboard: builder.query({
      query: (params = {}) => ({
        url: `/dashboard.php${params.range ? `?range=${encodeURIComponent(params.range)}` : ''}`,
      }),
      providesTags: ['Dashboard'],
    }),
    getActivityLogs: builder.query({
      query: (params) => ({ url: '/activity-log.php', params }),
      providesTags: ['ActivityLogs'],
    }),

    // ----- Employees -----
    getEmployees: builder.query({
      query: (params) => ({ url: '/employees.php', params }),
      providesTags: ['Employees'],
    }),
    getEmployee: builder.query({
      query: (id) => ({ url: `/employees.php?id=${id}` }),
      providesTags: ['Employees'],
    }),
    createEmployee: builder.mutation({
      query: (data) => ({ url: '/employees.php', method: 'POST', data }),
      invalidatesTags: ['Employees', 'Dashboard'],
    }),
    updateEmployee: builder.mutation({
      query: ({ id, data }) => ({ url: `/employees.php?id=${id}`, method: 'POST', data }),
      invalidatesTags: ['Employees'],
    }),
    deleteEmployee: builder.mutation({
      query: (id) => ({ url: `/employees.php?id=${id}`, method: 'DELETE' }),
      invalidatesTags: ['Employees', 'Dashboard'],
    }),

    // ----- Departments -----
    getDepartments: builder.query({
      query: () => ({ url: '/departments.php' }),
      providesTags: ['Departments'],
    }),
    seedDepartments: builder.mutation({
      query: () => ({ url: '/departments.php?seed=1', method: 'POST', data: { _seed: true } }),
      invalidatesTags: ['Departments'],
    }),

    createDepartment: builder.mutation({
      query: (data) => ({ url: '/departments.php', method: 'POST', data }),
      invalidatesTags: ['Departments'],
    }),
    updateDepartment: builder.mutation({
      query: ({ id, data }) => ({ url: `/departments.php?id=${id}`, method: 'PUT', data }),
      invalidatesTags: ['Departments', 'Employees'],
    }),
    deleteDepartment: builder.mutation({
      query: (id) => ({ url: `/departments.php?id=${id}`, method: 'DELETE' }),
      invalidatesTags: ['Departments'],
    }),


    getTeams: builder.query({
      query: () => ({ url: '/teams.php' }),
      providesTags: ['Teams'],
    }),
    seedTeams: builder.mutation({
      query: () => ({ url: '/teams.php?seed=1', method: 'POST', data: { _seed: true } }),
      invalidatesTags: ['Teams'],
    }),

    createTeam: builder.mutation({
      query: (data) => ({ url: '/teams.php', method: 'POST', data }),
      invalidatesTags: ['Teams'],
    }),
    updateTeam: builder.mutation({
      query: ({ id, data }) => ({ url: `/teams.php?id=${id}`, method: 'PUT', data }),
      invalidatesTags: ['Teams'],
    }),
    deleteTeam: builder.mutation({
      query: (id) => ({ url: `/teams.php?id=${id}`, method: 'DELETE' }),
      invalidatesTags: ['Teams'],
    }),

    // ----- Attendance Sheet -----
    getAttendanceSheet: builder.query({
      query: (params) => ({ url: '/attendance-sheet.php', params }),
      providesTags: ['Attendance'],
    }),
    updateTaskStatus: builder.mutation({
      query: (data) => ({ url: '/attendance-sheet.php?task_status=1', method: 'PUT', data }),
      invalidatesTags: ['Attendance'],
    }),

    // ----- Attendance -----
    getAttendance: builder.query({
      query: (params) => ({ url: '/attendance.php', params }),
      providesTags: ['Attendance'],
    }),
    getAttendanceStatusToday: builder.query({
      query: () => ({ url: '/attendance.php?today=1' }),
      providesTags: ['Attendance'],
    }),
    getAttendanceSettings: builder.query({
      query: () => ({ url: '/attendance.php?settings=1' }),
      providesTags: ['Attendance'],
    }),
    updateAttendanceSettings: builder.mutation({
      query: (data) => ({ url: '/attendance.php?settings=1', method: 'PUT', data }),
      invalidatesTags: ['Attendance'],
    }),
    checkin: builder.mutation({
      query: (data) => ({ url: '/attendance.php?action=checkin', method: 'POST', data }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),
    checkout: builder.mutation({
      query: (data) => ({ url: '/attendance.php?action=checkout', method: 'POST', data }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),
    startBreak: builder.mutation({
      query: (data) => ({ url: '/attendance.php?action=start_break', method: 'POST', data }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),
    endBreak: builder.mutation({
      query: () => ({ url: '/attendance.php?action=end_break', method: 'POST' }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),
    startMeeting: builder.mutation({
      query: () => ({ url: '/attendance.php?action=start_meeting', method: 'POST' }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),
    endMeeting: builder.mutation({
      query: () => ({ url: '/attendance.php?action=end_meeting', method: 'POST' }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),
    extendBreak: builder.mutation({
      query: (data) => ({ url: '/attendance.php?action=extend_break', method: 'POST', data }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),
    requestBreak: builder.mutation({
      query: (data) => ({ url: '/attendance.php?action=request_break', method: 'POST', data }),
      invalidatesTags: ['Attendance', 'Dashboard', 'Notifications'],
    }),
    requestMeeting: builder.mutation({
      query: () => ({ url: '/attendance.php?action=request_meeting', method: 'POST' }),
      invalidatesTags: ['Attendance', 'Dashboard', 'Notifications'],
    }),
    requestCheckoutUndo: builder.mutation({
      query: () => ({ url: '/attendance.php?action=request_checkout_undo', method: 'POST' }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),
    updateDailyTask: builder.mutation({
      query: (data) => ({ url: '/attendance.php?task_update=1', method: 'PUT', data }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),
    decideLateCheckin: builder.mutation({
      query: ({ action, notificationId }) => ({
        url: `/attendance.php?action=${action}_late_checkin`,
        method: 'POST',
        data: { notification_id: notificationId }
      }),
      invalidatesTags: ['Attendance', 'Dashboard', 'Notifications'],
    }),
    decideBreak: builder.mutation({
      query: ({ action, body }) => ({
        url: `/attendance.php?action=${action}_break`,
        method: 'POST',
        data: body
      }),
      invalidatesTags: ['Attendance', 'Dashboard', 'Notifications'],
    }),
    approveAllBreaks: builder.mutation({
      query: (data) => ({
        url: '/attendance.php?action=approve_all_breaks',
        method: 'POST',
        data
      }),
      invalidatesTags: ['Attendance', 'Dashboard', 'Notifications'],
    }),
    pauseResumeTimer: builder.mutation({
      query: ({ action, body }) => ({
        url: `/attendance.php?action=${action}`, // hr_pause_timer or hr_resume_timer or auto_pause_timer
        method: 'POST',
        data: body
      }),
      invalidatesTags: ['Attendance', 'WFHLive', 'WFH', 'Dashboard'],
    }),
    manualUpdateAttendance: builder.mutation({
      query: ({ id, status, body }) => ({
        url: `/attendance.php?id=${id}`,
        method: 'PUT',
        data: body || { status }
      }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),
    manualCreateAttendance: builder.mutation({
      query: (data) => ({ url: '/attendance.php', method: 'POST', data }),
      invalidatesTags: ['Attendance'],
    }),

    // ----- Leaves -----
    getLeaves: builder.query({
      query: (params) => ({ url: '/leaves.php', params }),
      providesTags: ['Leaves'],
    }),
    createLeave: builder.mutation({
      query: (data) => ({ url: '/leaves.php', method: 'POST', data }),
      invalidatesTags: ['Leaves', 'Dashboard'],
    }),
    decideLeave: builder.mutation({
      query: ({ id, status }) => ({ url: `/leaves.php?id=${id}`, method: 'PUT', data: { status } }),
      invalidatesTags: ['Leaves', 'Dashboard'],
    }),

    // ----- Work From Home -----
    getWFHRequests: builder.query({
      query: (params) => ({ url: '/wfh.php', params }),
      providesTags: ['WFH'],
    }),
    createWFHRequest: builder.mutation({
      query: (data) => ({ url: '/wfh.php', method: 'POST', data }),
      invalidatesTags: ['WFH', 'Dashboard'],
    }),
    decideWFHRequest: builder.mutation({
      query: ({ id, status }) => ({ url: `/wfh.php?id=${id}`, method: 'PUT', data: { status } }),
      invalidatesTags: ['WFH', 'Dashboard'],
    }),
    getWFHLiveStatus: builder.query({
      query: () => ({ url: '/wfh.php?action=live_status' }),
      providesTags: ['WFHLive'],
    }),
    getWFHMyStatusToday: builder.query({
      query: () => ({ url: '/wfh.php?action=my_status_today' }),
      providesTags: ['WFH'],
    }),
    submitWFHStatus: builder.mutation({
      query: (data) => ({ url: '/wfh.php?action=submit_status', method: 'POST', data }),
      invalidatesTags: ['WFHLive', 'WFH'],
    }),
    forceStopWFH: builder.mutation({
      query: (data) => ({ url: '/wfh.php?action=hr_force_stop_wfh', method: 'POST', data }),
      invalidatesTags: ['WFHLive', 'WFH', 'Attendance', 'Dashboard'],
    }),
    requestSleepMode: builder.mutation({
      query: (data) => ({ url: '/wfh.php?action=request_sleep_mode', method: 'POST', data }),
      invalidatesTags: ['WFHLive', 'WFH', 'Attendance'],
    }),
    decideSleepMode: builder.mutation({
      query: (data) => ({ url: '/wfh.php?action=decide_sleep_mode', method: 'POST', data }),
      invalidatesTags: ['WFHLive', 'WFH', 'Attendance', 'Notifications'],
    }),

    // ----- Holidays -----
    getHolidays: builder.query({
      query: () => ({ url: '/holidays.php' }),
      providesTags: ['Holidays'],
    }),
    createHoliday: builder.mutation({
      query: (data) => ({ url: '/holidays.php', method: 'POST', data }),
      invalidatesTags: ['Holidays'],
    }),
    updateHoliday: builder.mutation({
      query: ({ id, data }) => ({ url: `/holidays.php?id=${id}`, method: 'PUT', data }),
      invalidatesTags: ['Holidays'],
    }),
    deleteHoliday: builder.mutation({
      query: (id) => ({ url: `/holidays.php?id=${id}`, method: 'DELETE' }),
      invalidatesTags: ['Holidays'],
    }),

    // ----- Payroll -----
    getPayroll: builder.query({
      query: (params) => ({ url: '/payroll.php', params }),
      providesTags: ['Payroll'],
    }),
    generatePayroll: builder.mutation({
      query: (data) => ({ url: '/payroll.php', method: 'POST', data }),
      invalidatesTags: ['Payroll'],
    }),
    deletePayroll: builder.mutation({
      query: (id) => ({ url: `/payroll.php?id=${id}`, method: 'DELETE' }),
      invalidatesTags: ['Payroll'],
    }),
    getPayslipDetails: builder.query({
      query: (id) => ({ url: `/payslip.php?id=${id}` }),
    }),

    // ----- Notifications -----
    // Summary: returns only { unread_count } — used for badge polling
    getNotificationSummary: builder.query({
      query: (params = {}) => ({
        url: '/notifications.php',
        params: {
          summary: 1,
          ...(params.after ? { after: params.after } : {}),
        },
      }),
      serializeQueryArgs: ({ endpointName }) => endpointName,
      forceRefetch({ currentArg, previousArg }) {
        return currentArg?.after !== previousArg?.after;
      },
      providesTags: ['Notifications'],
    }),
    getNotifications: builder.query({
      query: (params = {}) => ({ url: '/notifications.php', params: { limit: params.limit || 30 } }),
      providesTags: ['Notifications'],
    }),
    readNotification: builder.mutation({
      query: (id) => ({ url: `/notifications.php?id=${id}`, method: 'PUT' }),
      // Optimistic update: mark item read locally, no full refetch needed
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        const patchFull = dispatch(
          apiSlice.util.updateQueryData('getNotifications', undefined, (draft) => {
            const n = draft?.data?.notifications?.find((n) => n.id === id)
            if (n) {
              n.is_read = true
              if (draft.data.unread_count > 0) draft.data.unread_count -= 1
            }
          })
        )
        const patchSummary = dispatch(
          apiSlice.util.updateQueryData('getNotificationSummary', undefined, (draft) => {
            if (draft?.data?.unread_count > 0) draft.data.unread_count -= 1
          })
        )
        try { await queryFulfilled } catch { patchFull.undo(); patchSummary.undo() }
      },
    }),
    clearAllNotifications: builder.mutation({
      query: () => ({ url: '/notifications.php', method: 'DELETE' }),
      // Optimistic update: clear list locally, no full refetch needed
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const patchFull = dispatch(
          apiSlice.util.updateQueryData('getNotifications', undefined, (draft) => {
            if (draft?.data) { draft.data.notifications = []; draft.data.unread_count = 0 }
          })
        )
        const patchSummary = dispatch(
          apiSlice.util.updateQueryData('getNotificationSummary', undefined, (draft) => {
            if (draft?.data) draft.data.unread_count = 0
          })
        )
        try { await queryFulfilled } catch { patchFull.undo(); patchSummary.undo() }
      },
    }),
    deleteNotification: builder.mutation({
      query: (id) => ({ url: `/notifications.php?id=${id}`, method: 'DELETE' }),
      // Optimistic update: remove item locally, no full refetch needed
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        const patchFull = dispatch(
          apiSlice.util.updateQueryData('getNotifications', undefined, (draft) => {
            if (draft?.data?.notifications) {
              const idx = draft.data.notifications.findIndex((n) => n.id === id)
              if (idx !== -1) {
                const wasUnread = !draft.data.notifications[idx].is_read
                draft.data.notifications.splice(idx, 1)
                if (wasUnread && draft.data.unread_count > 0) draft.data.unread_count -= 1
              }
            }
          })
        )
        const patchSummary = dispatch(
          apiSlice.util.updateQueryData('getNotificationSummary', undefined, (draft) => {
            if (draft?.data?.unread_count > 0) draft.data.unread_count -= 1
          })
        )
        try { await queryFulfilled } catch { patchFull.undo(); patchSummary.undo() }
      },
    }),
    // Mark all Leave or WFH request notifications as "viewed by HR" (sidebar badge)
    markRequestTypeViewed: builder.mutation({
      query: (type) => ({ url: `/notifications.php?view=${encodeURIComponent(type)}`, method: 'PUT' }),
      invalidatesTags: ['Notifications'],
    }),


    // ----- Recruitment (ATS) -----
    getRecruitments: builder.query({
      query: (params) => ({ url: '/recruitment.php', params }),
      providesTags: ['Recruitments'],
    }),
    createRecruitment: builder.mutation({
      query: (data) => ({ url: '/recruitment.php', method: 'POST', data }),
      invalidatesTags: ['Recruitments'],
    }),
    updateRecruitment: builder.mutation({
      query: ({ id, data }) => ({ url: `/recruitment.php?id=${id}`, method: 'PUT', data }),
      invalidatesTags: ['Recruitments'],
    }),
    deleteRecruitment: builder.mutation({
      query: (id) => ({ url: `/recruitment.php?id=${id}`, method: 'DELETE' }),
      invalidatesTags: ['Recruitments'],
    }),

    // ----- Performance Management (OKRs & Reviews) -----
    getGoals: builder.query({
      query: (params) => ({ url: '/performance.php', params }),
      providesTags: ['Goals'],
    }),
    createGoal: builder.mutation({
      query: (data) => ({ url: '/performance.php', method: 'POST', data }),
      invalidatesTags: ['Goals'],
    }),
    updateGoal: builder.mutation({
      query: ({ id, data }) => ({ url: `/performance.php?id=${id}`, method: 'PUT', data }),
      invalidatesTags: ['Goals'],
    }),
    deleteGoal: builder.mutation({
      query: (id) => ({ url: `/performance.php?id=${id}`, method: 'DELETE' }),
      invalidatesTags: ['Goals'],
    }),
    getGoalStats: builder.query({
      query: () => ({ url: '/performance.php?action=stats' }),
      providesTags: ['GoalStats'],
    }),

    // ----- Helpdesk / Ticketing -----
    getTickets: builder.query({
      query: (params) => ({ url: '/helpdesk.php', params }),
      providesTags: ['Tickets'],
    }),
    createTicket: builder.mutation({
      query: (data) => ({ url: '/helpdesk.php', method: 'POST', data }),
      invalidatesTags: ['Tickets'],
    }),
    updateTicket: builder.mutation({
      query: ({ id, data }) => ({ url: `/helpdesk.php?id=${id}`, method: 'PUT', data }),
      invalidatesTags: ['Tickets'],
    }),
    addTicketComment: builder.mutation({
      query: ({ id, comment }) => ({ url: `/helpdesk.php?action=comment&id=${id}`, method: 'POST', data: { comment } }),
      invalidatesTags: ['Tickets'],
    }),
    getTicketStats: builder.query({
      query: () => ({ url: '/helpdesk.php?action=stats' }),
      providesTags: ['TicketStats'],
    }),

    // ----- WebAuthn (Face ID) -----
    registerCredential: builder.mutation({
      query: (data) => ({ url: '/webauthn.php?action=register', method: 'POST', data }),
      invalidatesTags: [],
    }),
    loginCredential: builder.mutation({
      query: (data) => ({ url: '/webauthn.php?action=login', method: 'POST', data }),
      invalidatesTags: [],
    }),
  }),
});

export const {
  useGetMeQuery,
  useUpdateSoundSettingMutation,
  useLoginMutation,
  useLogoutMutation,
  useGetDashboardQuery,
  useGetActivityLogsQuery,
  useGetEmployeesQuery,
  useGetEmployeeQuery,
  useCreateEmployeeMutation,
  useUpdateEmployeeMutation,
  useDeleteEmployeeMutation,
  useGetDepartmentsQuery,
  useSeedDepartmentsMutation,
  useCreateDepartmentMutation,
  useUpdateDepartmentMutation,
  useDeleteDepartmentMutation,
  useGetTeamsQuery,
  useSeedTeamsMutation,
  useCreateTeamMutation,
  useUpdateTeamMutation,
  useDeleteTeamMutation,
  useGetAttendanceQuery,
  useGetAttendanceSheetQuery,
  useUpdateTaskStatusMutation,
  useGetAttendanceStatusTodayQuery,
  useGetAttendanceSettingsQuery,
  useUpdateAttendanceSettingsMutation,
  useCheckinMutation,
  useCheckoutMutation,
  useStartBreakMutation,
  useEndBreakMutation,
  useStartMeetingMutation,
  useEndMeetingMutation,
  useExtendBreakMutation,
  useRequestBreakMutation,
  useRequestMeetingMutation,
  useRequestCheckoutUndoMutation,
  useUpdateDailyTaskMutation,
  useDecideLateCheckinMutation,
  useDecideBreakMutation,
  useApproveAllBreaksMutation,
  usePauseResumeTimerMutation,
  useManualUpdateAttendanceMutation,
  useManualCreateAttendanceMutation,
  useGetLeavesQuery,
  useCreateLeaveMutation,
  useDecideLeaveMutation,
  useGetWFHRequestsQuery,
  useCreateWFHRequestMutation,
  useDecideWFHRequestMutation,
  useGetWFHLiveStatusQuery,
  useGetWFHMyStatusTodayQuery,
  useSubmitWFHStatusMutation,
  useForceStopWFHMutation,
  useRequestSleepModeMutation,
  useDecideSleepModeMutation,
  useGetHolidaysQuery,
  useCreateHolidayMutation,
  useUpdateHolidayMutation,
  useDeleteHolidayMutation,
  useGetPayrollQuery,
  useGeneratePayrollMutation,
  useDeletePayrollMutation,
  useGetPayslipDetailsQuery,
  useGetNotificationsQuery,
  useGetNotificationSummaryQuery,
  useReadNotificationMutation,
  useClearAllNotificationsMutation,
  useDeleteNotificationMutation,
  useMarkRequestTypeViewedMutation,

  // Recruitment
  useGetRecruitmentsQuery,
  useCreateRecruitmentMutation,
  useUpdateRecruitmentMutation,
  useDeleteRecruitmentMutation,
  // Performance
  useGetGoalsQuery,
  useCreateGoalMutation,
  useUpdateGoalMutation,
  useDeleteGoalMutation,
  useGetGoalStatsQuery,
  // Helpdesk
  useGetTicketsQuery,
  useCreateTicketMutation,
  useUpdateTicketMutation,
  useAddTicketCommentMutation,
  useGetTicketStatsQuery,
  // WebAuthn
  useRegisterCredentialMutation,
  useLoginCredentialMutation,
} = apiSlice;
