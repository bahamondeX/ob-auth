import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { useAuth } from '@oscarbahamonde/auth/react'
import './style.css'

function App() {
  const { user, login, logout, pending, error } = useAuth()
  const [message, setMessage] = useState('')
  async function signOut(everywhere: boolean) {
    setMessage('')
    try {
      await logout({ everywhere })
    } catch {
      setMessage('Could not sign out.')
    }
  }

  async function checkProtected() {
    try {
      const response = await fetch('/api/protected', { cache: 'no-store' })
      if (!response.ok) throw new Error('Unauthenticated')
      const { sub } = await response.json()
      setMessage('The server validated your identity: ' + sub)
    } catch {
      setMessage('The server could not validate your session.')
    }
  }

  return <main>
    <h1>React SSO example</h1>
    {pending ? <p>Checking your session…</p>
      : error ? <p role="alert">Could not check your session.</p>
        : user ? <>
          <p>Signed in as {user.email}</p>
          <button onClick={checkProtected}>Check protected API</button>
          <button onClick={() => signOut(false)}>Sign out of this app</button>
          <button onClick={() => signOut(true)}>Sign out everywhere</button>
        </> : <button onClick={() => login('/')}>Sign in with OB Auth</button>}
    <p role="status">{message}</p>
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
