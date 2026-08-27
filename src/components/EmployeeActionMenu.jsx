import React from 'react';
import { Edit2, Trash2 } from 'lucide-react';

export default function EmployeeActionMenu({ employee, onEdit, onDelete }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button
        type="button"
        className="emp-action-btn edit-btn"
        onClick={(e) => {
          e.stopPropagation();
          onEdit(employee);
        }}
        title="Edit employee"
        aria-label="Edit employee"
      >
        <Edit2 size={13} />
      </button>
      <button
        type="button"
        className="emp-action-btn delete-btn"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(employee);
        }}
        title="Delete employee"
        aria-label="Delete employee"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
