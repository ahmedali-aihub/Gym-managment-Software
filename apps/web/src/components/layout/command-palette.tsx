import { formatINR, type MemberStatus } from '@azf/shared';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import {
  BarChart3,
  CreditCard,
  Dumbbell,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  UserPlus,
  Users,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { MemberAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface MemberSearchResult {
  id: string;
  memberId: string;
  fullName: string;
  phone: string;
  photoUrl: string | null;
  status: MemberStatus;
  balanceDuePaise: number;
}

/**
 * Command palette (Ctrl/Cmd + K).
 *
 * This is the fastest path through the app for anyone who uses it daily:
 * a receptionist can find a member and open their profile without touching
 * the mouse, which matters when someone is waiting at the desk.
 *
 * Member search is debounced and only fires from two characters — a query on
 * every keystroke would hammer the API for results nobody reads.
 */
export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const navigate = useNavigate();
  const { resolvedTheme, toggleTheme } = useTheme();

  // Global shortcut.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 220);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset when closed so the next open starts clean.
  React.useEffect(() => {
    if (!open) {
      setSearch('');
      setDebounced('');
    }
  }, [open]);

  const { data: members, isFetching } = useQuery({
    queryKey: ['command-search', debounced],
    queryFn: async () => {
      const response = await api.get<{ data: MemberSearchResult[] }>(
        '/members',
        { params: { search: debounced, limit: 6 } },
      );
      return response.data.data;
    },
    enabled: open && debounced.trim().length >= 2,
    staleTime: 30_000,
  });

  const run = React.useCallback((action: () => void) => {
    setOpen(false);
    // Defer so the dialog closes before navigation, avoiding a flash of the
    // palette over the new route.
    requestAnimationFrame(action);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-sm animate-fade-in"
        onClick={() => setOpen(false)}
        aria-hidden
      />

      <Command
        className={cn(
          'relative w-full max-w-xl overflow-hidden rounded-2xl',
          'border border-border bg-popover shadow-large',
          'animate-slide-up',
        )}
        loop
        // cmdk's built-in filter would hide server-matched members whose
        // match is on a field the label does not contain (a phone number).
        shouldFilter={false}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Search members, or jump to a page…"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          {isFetching && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>

        <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
          <Command.Empty className="py-10 text-center text-sm text-muted-foreground">
            {debounced.length >= 2
              ? `No results for "${debounced}"`
              : 'Type to search'}
          </Command.Empty>

          {members && members.length > 0 && (
            <Command.Group
              heading="Members"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {members.map((member) => (
                <Command.Item
                  key={member.id}
                  value={`${member.fullName} ${member.memberId} ${member.phone}`}
                  onSelect={() => run(() => navigate(`/members/${member.id}`))}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-sm data-[selected=true]:bg-accent"
                >
                  <MemberAvatar
                    name={member.fullName}
                    photoUrl={member.photoUrl}
                    className="size-9"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{member.fullName}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {member.memberId}
                    </div>
                  </div>
                  {member.balanceDuePaise > 0 && (
                    <Badge variant="warning" size="sm" className="tabular">
                      {formatINR(member.balanceDuePaise, {
                        showDecimals: false,
                      })}{' '}
                      due
                    </Badge>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group
            heading="Actions"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            <PaletteItem
              icon={UserPlus}
              label="Register a new member"
              shortcut="N"
              onSelect={() => run(() => navigate('/members/new'))}
            />
            <PaletteItem
              icon={Plus}
              label="Record a payment"
              onSelect={() => run(() => navigate('/payments?action=new'))}
            />
            <PaletteItem
              icon={resolvedTheme === 'dark' ? Sun : Moon}
              label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
              onSelect={() => run(toggleTheme)}
            />
          </Command.Group>

          <Command.Group
            heading="Go to"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            <PaletteItem
              icon={LayoutDashboard}
              label="Dashboard"
              onSelect={() => run(() => navigate('/dashboard'))}
            />
            <PaletteItem
              icon={Users}
              label="Members"
              onSelect={() => run(() => navigate('/members'))}
            />
            <PaletteItem
              icon={CreditCard}
              label="Payments"
              onSelect={() => run(() => navigate('/payments'))}
            />
            <PaletteItem
              icon={MessageSquare}
              label="Messages"
              onSelect={() => run(() => navigate('/messages'))}
            />
            <PaletteItem
              icon={Dumbbell}
              label="Plans"
              onSelect={() => run(() => navigate('/plans'))}
            />
            <PaletteItem
              icon={BarChart3}
              label="Reports"
              onSelect={() => run(() => navigate('/reports'))}
            />
            <PaletteItem
              icon={Settings}
              label="Settings"
              onSelect={() => run(() => navigate('/settings'))}
            />
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

function PaletteItem({
  icon: Icon,
  label,
  shortcut,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-sm data-[selected=true]:bg-accent"
    >
      <Icon className="size-4 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {shortcut && (
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}
