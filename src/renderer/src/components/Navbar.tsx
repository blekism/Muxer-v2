import type { JSX } from 'react'

export function Navbar({
  title,
  description
}: {
  title: string
  description: string
}): JSX.Element {
  return (
    <header className="navbar">
      <h1 className="navbar__title">{title}</h1>
      <p className="navbar__desc">{description}</p>
    </header>
  )
}
