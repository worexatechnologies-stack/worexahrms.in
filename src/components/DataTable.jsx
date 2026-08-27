export default function DataTable({ columns, rows = [], empty = 'No records found', loading = false, rowKey = 'id', className = '', onRowClick }) {
  return (
    <div className={`table-wrap ${className}`.trim()}>
      <table>
        <thead>
          <tr>{columns.map((col) => <th key={col.key}>{col.label}</th>)}</tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={columns.length} className="table-empty-cell">Loading...</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="table-empty-cell">{empty}</td></tr>
          ) : rows.map((row, index) => (
            <tr
              key={typeof rowKey === 'function' ? rowKey(row) : row[rowKey] || index}
              onClick={onRowClick ? (e) => {
                // Don't trigger if clicked on a button, link or dropdown inside the row
                if (e.target.closest('button, a, select, input, .dropdown-menu, [role="menu"]')) return;
                onRowClick(row);
              } : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={col.className || ''}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
