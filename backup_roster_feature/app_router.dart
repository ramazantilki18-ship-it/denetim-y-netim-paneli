import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../models/audit_model.dart';
import '../models/task_model.dart';
import '../providers/audit_provider.dart';
import '../screens/splash_screen.dart';
import '../screens/login_screen.dart';
import '../screens/home_screen.dart';
import '../screens/start_audit_screen.dart';
import '../screens/audit_question_screen.dart';
import '../screens/audit_summary_screen.dart';
import '../screens/nonconformity_list_screen.dart';
import '../screens/nonconformity_detail_screen.dart';
import '../screens/close_nonconformity_screen.dart';
import '../screens/my_audits_screen.dart';
import '../screens/change_password_screen.dart';
import '../screens/feedback_management_screen.dart';
import '../screens/report_screen.dart';
import '../widgets/bottom_nav_shell.dart';

class AppRouter {
  static final router = GoRouter(
    initialLocation: '/splash',
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      // Alt Bar Navigasyonu (ShellRoute)
      ShellRoute(
        builder: (context, state, child) => BottomNavShell(location: state.uri.path, child: child),
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) => const HomeScreen(),
          ),
          GoRoute(
            path: '/my-audits',
            builder: (context, state) => const MyAuditsScreen(),
          ),
          GoRoute(
            path: '/nonconformities',
            builder: (context, state) => const NonconformityListScreen(),
          ),
          GoRoute(
            path: '/reports',
            builder: (context, state) => const ReportScreen(),
          ),
        ],
      ),
      // Bağımsız Tam Ekran Rotalar (Alt Barsız)
      GoRoute(
        path: '/start-audit',
        builder: (context, state) {
          final task = state.extra as TaskModel?;
          return StartAuditScreen(task: task);
        },
      ),
      GoRoute(
        path: '/audit-questions',
        builder: (context, state) => const AuditQuestionScreen(),
      ),
      GoRoute(
        path: '/audit-summary/:id',
        builder: (context, state) {
          final id = state.pathParameters['id'];
          if (state.extra != null) {
            return AuditSummaryScreen(audit: state.extra as AuditModel);
          }
          // Extra yoksa provider'dan bul
          try {
            final provider = Provider.of<AuditProvider>(context, listen: false);
            final audit = provider.auditHistory.firstWhere((a) => a.id == id);
            return AuditSummaryScreen(audit: audit);
          } catch (_) {
            return const AuditSummaryScreen(audit: null);
          }
        },
      ),
      GoRoute(
        path: '/nonconformity-detail/:id',
        builder: (context, state) => NonconformityDetailScreen(id: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/close-nonconformity/:id',
        builder: (context, state) => CloseNonconformityScreen(id: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/change-password',
        builder: (context, state) => const ChangePasswordScreen(),
      ),
      GoRoute(
        path: '/feedback-management',
        builder: (context, state) => const FeedbackManagementScreen(),
      ),
    ],
  );
}
