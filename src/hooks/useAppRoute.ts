import { useCallback, useEffect, useState } from 'react'

export type AppRoute = 'workbench' | 'settings' | 'models'

const ROUTE_CHANGE_EVENT = 'scicanvas:route-change'

/**
 * 从 URL pathname / hash 解析当前页面路由，同时兼容 Web 开发模式（/settings、/models）与 Tauri 打包环境（#/settings、#/models）。
 */
export function parseAppRoute(pathname: string, hash: string): AppRoute {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/'
  const normalizedHash = hash.replace(/^#/, '').replace(/\/+$/, '')

  if (normalizedPath === '/settings' || normalizedHash === '/settings') {
    return 'settings'
  }
  if (normalizedPath === '/models' || normalizedHash === '/models') {
    return 'models'
  }
  return 'workbench'
}

function getCurrentRoute(): AppRoute {
  if (typeof window === 'undefined') return 'workbench'
  return parseAppRoute(window.location.pathname, window.location.hash)
}

function shouldUseHashRouting(): boolean {
  if (typeof window === 'undefined') return false
  const { protocol, pathname } = window.location
  if (protocol !== 'http:' && protocol !== 'https:') return true
  return pathname.endsWith('.html')
}

function routeToPath(route: AppRoute): string {
  if (route === 'settings') return '/settings'
  if (route === 'models') return '/models'
  return '/'
}

export function navigateAppRoute(route: AppRoute): void {
  if (typeof window === 'undefined') return
  const current = getCurrentRoute()
  if (current === route) return

  if (shouldUseHashRouting()) {
    window.location.hash = route === 'workbench' ? '' : `#${routeToPath(route)}`
  } else {
    window.history.pushState(null, '', routeToPath(route))
  }
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT))
}

export function useAppRoute(): {
  route: AppRoute
  navigate: (route: AppRoute) => void
} {
  const [route, setRoute] = useState<AppRoute>(getCurrentRoute)

  useEffect(() => {
    const syncRoute = () => setRoute(getCurrentRoute())
    window.addEventListener('popstate', syncRoute)
    window.addEventListener('hashchange', syncRoute)
    window.addEventListener(ROUTE_CHANGE_EVENT, syncRoute)
    return () => {
      window.removeEventListener('popstate', syncRoute)
      window.removeEventListener('hashchange', syncRoute)
      window.removeEventListener(ROUTE_CHANGE_EVENT, syncRoute)
    }
  }, [])

  const navigate = useCallback((next: AppRoute) => {
    navigateAppRoute(next)
    setRoute(next)
  }, [])

  return { route, navigate }
}
