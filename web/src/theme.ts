'use client';

// GitHub-dark palette — sibling convention (MPEx/LOLA): near-black
// surfaces, laser-blue accent.
import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#0d1117', paper: '#161b22' },
    primary: { main: '#58a6ff' },
    secondary: { main: '#8b949e' },
    divider: '#30363d',
    text: { primary: '#e6edf3', secondary: '#8b949e' },
  },
  shape: { borderRadius: 6 },
  typography: { fontFamily: '"Segoe UI", "Helvetica Neue", sans-serif', fontSize: 13 },
  components: {
    MuiCard: { styleOverrides: { root: { border: '1px solid #30363d' } } },
    MuiButton: { styleOverrides: { root: { textTransform: 'none' } } },
  },
});
