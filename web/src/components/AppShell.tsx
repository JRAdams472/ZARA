'use client';

import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import RuleIcon from '@mui/icons-material/AccountTree';
import HistoryIcon from '@mui/icons-material/History';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ENVS, type Env, type Role, type Whoami } from '@/lib/types';

const DRAWER_WIDTH = 224;

const ROLE_LABEL: Record<Role, string> = {
  tenant_auditor: 'Auditor',
  tenant_rule_engineer: 'Rule Engineer',
  tenant_release_manager: 'Release Manager',
};
const ROLE_COLOR: Record<Role, 'default' | 'primary' | 'warning'> = {
  tenant_auditor: 'default',
  tenant_rule_engineer: 'primary',
  tenant_release_manager: 'warning',
};

function highestRole(roles: readonly Role[]): Role | undefined {
  if (roles.includes('tenant_release_manager')) return 'tenant_release_manager';
  if (roles.includes('tenant_rule_engineer')) return 'tenant_rule_engineer';
  return roles[0];
}

const NAV = [
  { suffix: 'rules', label: 'Rules', icon: <RuleIcon fontSize="small" /> },
  { suffix: 'promotions', label: 'Promotions', icon: <HistoryIcon fontSize="small" /> },
];

export default function AppShell({
  whoami,
  env,
  email,
  children,
}: {
  whoami: Whoami;
  env: Env;
  /** Session email — whoami's `sub` is connector-encoded in some IdPs. */
  email?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const role = highestRole(whoami.roles);
  const section = NAV.find((n) => pathname?.endsWith(`/${n.suffix}`))?.suffix ?? 'rules';

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: (t) => t.zIndex.drawer + 1,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Toolbar variant="dense" sx={{ gap: 2 }}>
          <Typography
            variant="h6"
            component={Link}
            href="/"
            sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 700 }}
          >
            Zara
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 2 }}>
            Mortgage fee rules
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexGrow: 1 }}>
            {ENVS.map((e) => {
              const allowed = whoami.effectiveEnvs.includes(e);
              const chip = (
                <Chip
                  key={e}
                  label={e.toUpperCase()}
                  size="small"
                  component={allowed ? Link : 'span'}
                  href={allowed ? `/${e}/${section}` : undefined}
                  clickable={allowed}
                  color={e === env ? 'primary' : 'default'}
                  variant={e === env ? 'filled' : 'outlined'}
                  icon={allowed ? undefined : <LockOutlinedIcon />}
                  sx={{ minWidth: 56, opacity: allowed ? 1 : 0.45 }}
                />
              );
              return allowed ? (
                chip
              ) : (
                <Tooltip key={e} title="No access in this environment">{chip}</Tooltip>
              );
            })}
          </Box>
          {role && (
            <Chip
              size="small"
              color={ROLE_COLOR[role]}
              variant="outlined"
              label={ROLE_LABEL[role]}
            />
          )}
          <Chip
            size="small"
            variant="outlined"
            label={email ?? whoami.sub}
            sx={{ maxWidth: 240 }}
          />
          <Tooltip title="Sign out">
            <IconButton size="small" component="a" href="/auth/logout" aria-label="Sign out">
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            bgcolor: 'background.paper',
            borderRight: 1,
            borderColor: 'divider',
          },
        }}
      >
        <Toolbar variant="dense" />
        <Box sx={{ px: 1.5, py: 2 }}>
          <Typography variant="overline" color="text.secondary" sx={{ px: 1 }}>
            {env.toUpperCase()} environment
          </Typography>
          <List dense>
            {NAV.map((n) => (
              <ListItemButton
                key={n.suffix}
                component={Link}
                href={`/${env}/${n.suffix}`}
                selected={section === n.suffix}
                sx={{ borderRadius: 1, gap: 1.5 }}
              >
                {n.icon}
                <ListItemText primary={n.label} />
              </ListItemButton>
            ))}
          </List>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="caption" color="text.secondary" sx={{ px: 1, display: 'block' }}>
            Access: {whoami.envAccess[env]}
          </Typography>
        </Box>
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
        <Toolbar variant="dense" />
        {children}
      </Box>
    </Box>
  );
}
