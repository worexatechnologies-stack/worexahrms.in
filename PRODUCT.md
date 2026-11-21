# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **HR Administrators & Management**: Oversee organizational workforce operations, enforce attendance & break policies, process monthly payroll, manage leaves/holidays, approve WFH requests, monitor live employee presence, and handle tenant-level configurations.
- **Employees (Staff)**: Daily operational users clocking in/out, managing work & pause/break intervals in real time, requesting leaves, submitting WFH applications, reviewing monthly payslips, and checking organizational directory.

## Product Purpose

Worexa HRMS provides unified, reliable, and real-time human resource management for Worexa and its managed client organizations (such as Viyana Production). It eliminates manual attendance discrepancies, streamlines compliance and payroll cycles, and gives employees frictionless self-service access to daily work tracking and HR services.

## Positioning

A lightweight, multi-tenant workforce operations platform engineered for real-time attendance precision, combining live browser session tracking, idle activity monitoring, break management, and hardware biometric (eSSL) synchronization into a responsive single-page portal.

## Operating Context

- **Environment**: Web application accessed by staff on office desktop/laptop browsers and mobile devices.
- **Daily Rituals**: Morning punch-in / biometric sync, active timer tracking during work sessions, break pause/resumption with reason tracking, end-of-day sign-out, month-end payroll review and payslip distribution.
- **Multi-Tenant Boundaries**: Supports company-specific databases (`hrms`, `hrms_viyana`) with scoped access, tenant branding, and tenant-specific payroll/attendance settings.

## Capabilities and Constraints

- **Capabilities**:
  - Live attendance timer, break session logging, and overtime tracking.
  - Hardware biometric integration (eSSL) with IP/port sync.
  - Employee directory, profiles, departments, and team hierarchies.
  - Leave lifecycle management (requests, balances, approval workflows).
  - Monthly payroll generation, payslip PDF generation, and salary breakdown.
  - Multi-tenant routing and company context switching.
  - Notification engine with audible alerts, sound preferences, and theme toggle (light/dark).
  - WFH attendance tracking with location/IP validation.
- **Technical Constraints**:
  - Frontend: React 19, Redux Toolkit, Tailwind CSS v4, Vite.
  - Backend: PHP 8.1+ REST API running over local development port or production web server.
  - Database: MongoDB (BSON data models, dynamic tenant databases).

## Brand Commitments

- **Identity**: Worexa HRMS with dedicated enterprise brand assets (`src/assets/logo.png`).
- **Tone**: Professional, clear, dependable, and efficient.
- **Visuals**: Dark/light operational themes with accessible high-contrast data tables, crisp typography, and unambiguous status indicators.

## Evidence on Hand

- **Production-grade data**: Real schemas, collections, indexes, and document structures for employees, attendance, break sessions, notifications, payroll, and payslips.
- **Assets**: Branded logos, motivation quote repository (`motivationQuotes.js`), and audio cues for notification events.

## Product Principles

1. **Precision First**: Attendance, break times, and payroll figures must be authoritative, transparent, and accurate down to the minute.
2. **Operational Speed**: Fast, scan-friendly interfaces designed for quick task completion (clocking in, reviewing requests, running payroll) with zero cognitive overhead.
3. **Fail-Safe Tenancy**: Tenant data isolation across companies (Worexa vs. Viyana) must be strictly enforced at every route and API touchpoint.
4. **Frictionless Self-Service**: Employees should be able to check their status, view payslips, and apply for leaves in seconds without HR intervention.

