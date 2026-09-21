import type { Config } from 'tailwindcss';
import voidSpacePreset from '@void-space/config/tailwind/preset';

const config: Config = {
  presets: [voidSpacePreset as Config],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Product palette from the VOID·SPACE brand: deep space + signal violet.
        void: {
          950: 'hsl(258 45% 6%)',
          900: 'hsl(258 40% 10%)',
          800: 'hsl(258 35% 16%)',
        },
        signal: {
          DEFAULT: 'hsl(268 85% 68%)',
          muted: 'hsl(268 45% 45%)',
        },
      },
    },
  },
};

export default config;
