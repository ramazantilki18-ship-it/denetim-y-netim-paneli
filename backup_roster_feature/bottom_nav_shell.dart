import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../theme/app_colors.dart';
import '../providers/auth_provider.dart';
import '../models/user_model.dart';

class BottomNavShell extends StatelessWidget {
  final String location;
  final Widget child;

  const BottomNavShell({super.key, required this.child, required this.location});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final user = context.watch<AuthProvider>().user;
    final showReports = user != null && 
        user.role != UserRole.fieldAuditor && 
        user.role != UserRole.fieldAuditorActionOwner;

    return Scaffold(
      body: child,
      bottomNavigationBar: SafeArea(
        top: false,
        minimum: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Container(
          height: 76,
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF1E293B) : Colors.white,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: isDark ? 0.5 : 0.1),
                blurRadius: 30,
                offset: const Offset(0, -8),
              ),
            ],
            border: Border.all(
              color: isDark ? Colors.white.withValues(alpha: 0.1) : Colors.grey.withValues(alpha: 0.08),
              width: 1,
            ),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildNavItem(context, '/', Icons.space_dashboard_rounded, Icons.space_dashboard_outlined, 'Panel'),
                _buildNavItem(context, '/my-audits', Icons.assignment_turned_in_rounded, Icons.assignment_turned_in_outlined, 'Denetim'),
                _buildNavItem(context, '/nonconformities', Icons.gpp_maybe_rounded, Icons.gpp_maybe_outlined, 'Takip'),
                if (showReports)
                  _buildNavItem(context, '/reports', Icons.analytics_rounded, Icons.analytics_outlined, 'Analiz'),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildNavItem(BuildContext context, String route, IconData selectedIcon, IconData unselectedIcon, String label) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isSelected = location == route || (route != '/' && location.startsWith(route));
    
    final activeColor = isDark ? const Color(0xFFFF5722) : AppColors.accentRed; // Turuncu renk
    final Color inactiveColor = isDark ? Colors.white.withValues(alpha: 0.4) : (Colors.blueGrey[400] ?? Colors.grey);

    return Expanded(
      child: InkWell(
        key: ValueKey(route),
        onTap: () => context.go(route),
        splashColor: Colors.transparent,
        highlightColor: Colors.transparent,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // İkon
            Icon(
              isSelected ? selectedIcon : unselectedIcon, 
              color: isSelected ? activeColor : inactiveColor, 
              size: 24,
            ),
            const SizedBox(height: 2),
            // Etiket
            Text(
              label,
              style: TextStyle(
                color: isSelected ? activeColor : inactiveColor,
                fontSize: 10,
                fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}
