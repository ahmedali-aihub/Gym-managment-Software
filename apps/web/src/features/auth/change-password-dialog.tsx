import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChangePasswordForm } from './change-password-page';

/**
 * Change your own password, from the account menu.
 *
 * Until this existed the only password screen was the forced one, so a
 * user who suspected their password had been seen — or an owner whose
 * password had been set by someone else — had no way to change it.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            You will be signed out on every device and sign in again with the
            new password.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          <ChangePasswordForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}
