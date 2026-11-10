import {
  useId,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type JSX,
  type ReactNode
} from 'react'

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ')

/* ---------------------------------- Icons --------------------------------- */

const ICON_PATHS = {
  film: [
    'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    'M7 4v16',
    'M17 4v16',
    'M3 12h18'
  ],
  download: ['M12 4v11', 'M8 11l4 4 4-4', 'M5 20h14'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  plus: ['M12 5v14', 'M5 12h14'],
  trash: [
    'M4 7h16',
    'M10 11v6',
    'M14 11v6',
    'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12',
    'M9 7V4h6v3'
  ],
  music: [
    'M9 18V5l12-2v13',
    'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'
  ],
  dice: [
    'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z',
    'M9 9h.01',
    'M15 15h.01',
    'M12 12h.01'
  ],
  reset: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
  image: [
    'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    'M9 10h.01',
    'M4 17l5-5 4 4 3-3 4 4'
  ],
  play: ['M8 5v14l11-7z'],
  pause: ['M7 5v14', 'M17 5v14'],
  link: [
    'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1',
    'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1'
  ],
  retry: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  chevron: ['M9 6l6 6-6 6'],
  warning: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17h.01']
} as const

export type IconName = keyof typeof ICON_PATHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/** App logo mark: a rounded square with a play triangle. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="icon brand__mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--accent)" />
      <path d="M10 8l6 4-6 4z" fill="var(--accent-contrast)" />
    </svg>
  )
}

/* --------------------------------- Buttons -------------------------------- */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn--${variant}`, `btn--${size}`, className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'lg' ? 18 : 15} />}
      {children}
    </button>
  )
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName
  /** Required: icon-only buttons need an accessible name. */
  label: string
}

export function IconButton({ icon, label, type = 'button', className, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx('icon-btn', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  )
}

export function Checkbox({
  checked,
  indeterminate = false,
  label,
  onChange
}: {
  checked: boolean
  indeterminate?: boolean
  /** Required: the box has no visible text. */
  label: string
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <input
      type="checkbox"
      className="checkbox"
      checked={checked}
      aria-label={label}
      title={label}
      ref={(element) => {
        if (element) element.indeterminate = indeterminate
      }}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

/* --------------------------------- Layout --------------------------------- */

interface PanelProps {
  title: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function Panel({ title, actions, children, className, bodyClassName }: PanelProps) {
  const titleId = useId()
  return (
    <section className={cx('panel', className)} aria-labelledby={titleId}>
      <header className="panel__header">
        <h2 id={titleId} className="panel__title">
          {title}
        </h2>
        {actions && <div className="panel__actions">{actions}</div>}
      </header>
      <div className={cx('panel__body', bodyClassName)}>{children}</div>
    </section>
  )
}

export function EmptyState({
  icon,
  title,
  hint
}: {
  icon: IconName
  title: string
  hint?: string
}) {
  return (
    <div className="empty">
      <Icon name={icon} size={22} />
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  )
}

export function Thumb({
  src,
  alt = '',
  className
}: {
  src?: string
  alt?: string
  className?: string
}) {
  if (!src) {
    return (
      <span className={cx('thumb', 'thumb--empty', className)} aria-hidden="true">
        <Icon name="film" size={18} />
      </span>
    )
  }
  return (
    <img className={cx('thumb', className)} src={src} alt={alt} loading="lazy" decoding="async" />
  )
}

/* --------------------------------- Controls ------------------------------- */

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  format?: (value: number) => string
  onChange: (value: number) => void
}

export function Slider({ label, value, min, max, step, unit = '', format, onChange }: SliderProps) {
  const id = useId()
  const percent = ((value - min) / (max - min)) * 100
  return (
    <div className="slider">
      <div className="slider__row">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>
          {format ? format(value) : `${Number(value.toFixed(2))}${unit}`}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${percent}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

interface SegmentedProps<T extends string> {
  legend: string
  hideLegend?: boolean
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

export function Segmented<T extends string>({
  legend,
  hideLegend,
  options,
  value,
  onChange
}: SegmentedProps<T>) {
  const name = useId()
  return (
    <fieldset className="segmented">
      <legend className={cx('segmented__legend', hideLegend && 'sr-only')}>{legend}</legend>
      <div className="segmented__track">
        {options.map((option) => (
          <label key={option.value} className="segmented__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export interface RadioListItem {
  id: string
  label: string
  meta?: string
}

interface RadioListProps {
  legend: string
  items: readonly RadioListItem[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onDelete?: (id: string) => void
  /** When set, adds a first option that clears the selection. */
  noneLabel?: string
}

export function RadioList({
  legend,
  items,
  selectedId,
  onSelect,
  onDelete,
  noneLabel
}: RadioListProps) {
  const name = useId()
  return (
    <fieldset className="radio-list">
      <legend className="sr-only">{legend}</legend>
      <ul>
        {noneLabel && (
          <li className="radio-list__item">
            <label className="radio-list__label">
              <input
                type="radio"
                name={name}
                checked={selectedId === null}
                onChange={() => onSelect(null)}
              />
              <span className="radio-list__text">{noneLabel}</span>
            </label>
          </li>
        )}
        {items.map((item) => (
          <li key={item.id} className="radio-list__item">
            <label className="radio-list__label">
              <input
                type="radio"
                name={name}
                checked={selectedId === item.id}
                onChange={() => onSelect(item.id)}
              />
              <span className="radio-list__text">
                <span className="truncate" title={item.label}>
                  {item.label}
                </span>
                {item.meta && <small>{item.meta}</small>}
              </span>
            </label>
            {onDelete && (
              <IconButton
                icon="trash"
                label={`Delete ${item.label}`}
                onClick={() => onDelete(item.id)}
              />
            )}
          </li>
        ))}
      </ul>
    </fieldset>
  )
}
