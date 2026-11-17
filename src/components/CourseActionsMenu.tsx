import { useRef } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Ellipsis } from 'lucide-react';

type MenuAction = {
  label: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
};

export function CourseActionsMenu({ label, actions, disabled }: {
  label: string; actions: MenuAction[]; disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = useRef<() => void>(undefined);
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild>
      <button ref={trigger} type="button" disabled={disabled} className="quiet-button course-overflow-trigger" aria-label={label} title={label}>
        <Ellipsis className="tool-icon" aria-hidden="true" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="course-management-actions course-overflow-menu" aria-label={label} align="end"
        sideOffset={4} collisionPadding={8} loop hideWhenDetached onCloseAutoFocus={(event) => {
          const action = selected.current;
          selected.current = undefined;
          if (!action) return;
          event.preventDefault();
          trigger.current?.focus({ preventScroll: true });
          action();
        }}>
        {actions.map((action) => <DropdownMenu.Item key={action.label} className={'course-management-item' + (action.danger ? ' danger-button' : '')}
          disabled={action.disabled} onSelect={() => { selected.current = action.run; }}>{action.label}</DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
