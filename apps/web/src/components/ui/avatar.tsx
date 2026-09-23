import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as React from 'react';
import { cn, getInitials, stringToColor } from '@/lib/utils';

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex size-10 shrink-0 overflow-hidden rounded-full',
      className,
    )}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn('aspect-square size-full object-cover', className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      'flex size-full items-center justify-center rounded-full bg-muted text-sm font-semibold',
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

/**
 * Member avatar with a deterministic colour fallback.
 *
 * Most gym members will not have a photo on file, so the fallback is the
 * common case, not the exception. Deriving the tint from the name means a
 * member looks the same every time you see them — which is what makes a list
 * of initials scannable rather than noisy.
 */
interface MemberAvatarProps {
  name: string;
  photoUrl?: string | null;
  className?: string;
  /** Green ring for a currently-checked-in member. */
  showStatus?: boolean;
}

function MemberAvatar({
  name,
  photoUrl,
  className,
  showStatus,
}: MemberAvatarProps) {
  return (
    <div className="relative shrink-0">
      <Avatar className={className}>
        {photoUrl && <AvatarImage src={photoUrl} alt="" />}
        <AvatarFallback className={cn(stringToColor(name), 'font-display')}>
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
      {showStatus && (
        <span
          className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-card bg-success"
          aria-label="Currently checked in"
        />
      )}
    </div>
  );
}

export { Avatar, AvatarImage, AvatarFallback, MemberAvatar };
