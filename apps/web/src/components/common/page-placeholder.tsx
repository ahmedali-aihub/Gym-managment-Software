import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/common/states';
import { Card } from '@/components/ui/card';

/**
 * Placeholder for routes whose screens are not built yet.
 *
 * Deliberately explicit about what is coming rather than showing a blank
 * page — a stub that names the feature is far less alarming to a user than
 * one that looks broken.
 */
export function PagePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h1>
      </div>

      <Card>
        <EmptyState
          icon={Construction}
          title="Coming in the next phase"
          description={description}
        />
      </Card>
    </div>
  );
}
