import { Copy } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { SegmentedControl } from '@/components/common/segmented-control';
import { WhatsappLogo } from '@/components/icons/nav-icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  getWhatsAppTarget,
  isPhoneDevice,
  openWhatsApp,
  setWhatsAppTarget,
  type WhatsAppMessage,
  type WhatsAppTarget,
} from '@/lib/whatsapp';

export interface WhatsAppSendState {
  /** What is being sent, e.g. "Welcome message". */
  title: string;
  recipient: string;
  message: WhatsAppMessage;
  /** Whether WhatsApp actually opened, or the browser blocked it. */
  opened: boolean;
}

/** A message ready to send, before WhatsApp has been opened with it. */
export type WhatsAppHandoff = Omit<WhatsAppSendState, 'opened'>;

/**
 * How long a confirmation stays on screen before WhatsApp takes over.
 *
 * On a phone, opening WhatsApp leaves the browser at once, so the desk
 * never saw "Membership renewed". Two seconds is long enough to read the
 * notice and short enough to stay inside the window in which browsers still
 * count the open as part of the tap. If a slow connection pushes it past
 * that and the browser blocks it, the dialog offers an Open WhatsApp button.
 */
export const WHATSAPP_HANDOFF_DELAY_MS = 2000;

/**
 * Fetch a message, open WhatsApp with it, and keep what happened for the
 * dialog. Opening straight from the click matters: browsers only allow a
 * new tab shortly after one.
 */
export function useWhatsAppSend() {
  const [state, setState] = React.useState<WhatsAppSendState | null>(null);
  const [sending, setSending] = React.useState(false);
  const handoffTimer = React.useRef<number | undefined>(undefined);

  /**
   * Open WhatsApp after the confirmation has had its moment, then show the
   * dialog with what happened. A second call replaces a pending one, so a
   * hand-off cannot open WhatsApp twice.
   */
  function openLater(
    handoff: WhatsAppHandoff,
    delayMs: number = WHATSAPP_HANDOFF_DELAY_MS,
  ) {
    window.clearTimeout(handoffTimer.current);
    handoffTimer.current = window.setTimeout(() => {
      setState({ ...handoff, opened: openWhatsApp(handoff.message) });
    }, delayMs);
  }

  async function send(
    load: () => Promise<WhatsAppMessage>,
    details: { title: string; recipient: string },
  ) {
    setSending(true);
    try {
      const message = await load();
      setState({ ...details, message, opened: openWhatsApp(message) });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  return { state, setState, sending, send, openLater };
}

/**
 * After WhatsApp opens on the member's chat: what was typed for them, and a
 * way back in if the browser blocked the tab or the chat was closed.
 */
export function WhatsAppSendDialog({
  state,
  onClose,
}: {
  state: WhatsAppSendState | null;
  onClose: () => void;
}) {
  const [target, setTarget] = React.useState<WhatsAppTarget>(getWhatsAppTarget);
  const phone = isPhoneDevice();

  function chooseTarget(next: WhatsAppTarget) {
    setTarget(next);
    setWhatsAppTarget(next);
  }

  async function copyText() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.message.text);
      toast.success('Message copied');
    } catch {
      toast.error('Could not copy — select the text and copy it instead');
    }
  }

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WhatsappLogo weight="fill" className="size-5 text-[#25D366]" />
            {state?.title}
          </DialogTitle>
          <DialogDescription>To {state?.recipient}</DialogDescription>
        </DialogHeader>

        {state && (
          <div className="mt-4 space-y-4">
            <div
              className={cn(
                'rounded-xl px-4 py-3 text-[13px] leading-relaxed',
                state.opened
                  ? 'bg-success/[0.08] text-success'
                  : 'bg-warning/[0.08] text-warning',
              )}
              role="status"
            >
              {state.opened
                ? 'WhatsApp is open with this message on their chat. Press Send there.'
                : 'Your browser stopped WhatsApp from opening. Click Open WhatsApp below.'}
            </div>

            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/40 px-4 py-3 text-[13px] leading-relaxed">
              <WhatsAppFormatted text={state.message.text} />
            </div>

            {!phone && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] text-muted-foreground">
                  On this computer, open with
                </span>
                <SegmentedControl
                  size="sm"
                  ariaLabel="Open WhatsApp with"
                  value={target}
                  onChange={chooseTarget}
                  options={[
                    { value: 'web', label: 'WhatsApp Web' },
                    { value: 'app', label: 'WhatsApp app' },
                  ]}
                />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={copyText}>
                <Copy />
                Copy text
              </Button>
              <Button type="button" onClick={() => openWhatsApp(state.message)}>
                <WhatsappLogo weight="fill" />
                Open WhatsApp
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** WhatsApp shows *text* in bold; the preview does too, so it matches. */
function WhatsAppFormatted({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*[^*\n]+\*)/g).map((part, index) =>
        /^\*[^*\n]+\*$/.test(part) ? (
          <strong key={index} className="font-semibold">
            {part.slice(1, -1)}
          </strong>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}
