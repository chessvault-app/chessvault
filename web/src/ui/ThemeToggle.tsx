import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/store/theme';
import { Button } from './Button';

const icons: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const labels: Record<ThemePreference, string> = {
  light: 'Light theme',
  dark: 'Dark theme',
  system: 'System theme',
};

export function ThemeToggle() {
  const preference = useTheme((s) => s.preference);
  const cycle = useTheme((s) => s.cycle);
  const Icon = icons[preference];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      title={`${labels[preference]} — click to change`}
      aria-label={labels[preference]}
    >
      <Icon className="size-[1.05rem]" strokeWidth={2} />
    </Button>
  );
}
