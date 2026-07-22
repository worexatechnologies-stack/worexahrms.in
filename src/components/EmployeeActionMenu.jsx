import React from 'react';
import ActionButton from './ui/ActionButton';
import { Edit2, Trash2 } from 'lucide-react';

export default function EmployeeActionMenu({ employee, onEdit, onDelete }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <ActionButton
        icon={<Edit2 size={13} />}
        iconOnly
        onClick={() => onEdit(employee)}
        title="Edit"
      />
      <ActionButton
        icon={<Trash2 size={13} />}
        iconOnly
        variant="danger"
        onClick={() => onDelete(employee)}
        title="Delete"
      />
    </div>
  );
}
