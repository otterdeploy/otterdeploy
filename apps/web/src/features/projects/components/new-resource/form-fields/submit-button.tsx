import { useFormContext } from "../form-context";
import { Button } from "@/shared/components/ui/button";

interface SubmitButtonProps {
  children: React.ReactNode;
  className?: string;
}

export function SubmitButton({ children, className }: SubmitButtonProps) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
      {([canSubmit, isSubmitting]) => (
        <Button
          type="submit"
          size="sm"
          className={className}
          disabled={!canSubmit || isSubmitting}
          onClick={() => void form.handleSubmit()}
        >
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}
