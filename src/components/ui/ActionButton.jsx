export default function ActionButton({
  children,
  icon,
  variant = 'secondary',
  size = 'sm',
  iconOnly = false,
  className = '',
  ...props
}) {
  const classes = [
    'btn',
    size === 'sm' ? 'btn-sm' : '',
    iconOnly ? 'btn-icon' : '',
    `btn-${variant}`,
    className
  ].filter(Boolean).join(' ')

  return (
    <button className={classes} type="button" {...props}>
      {icon}
      {!iconOnly && children}
    </button>
  )
}
