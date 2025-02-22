import fs from 'fs'
import path from 'path'
import consola from 'consola'
import recursiveRead from './recursive-readdir-sync'
import { sentenceCase } from 'change-case'

const packagesRoot = path.resolve(__dirname, '../packages')
const playgroundRoot = path.resolve(__dirname, '../playground/src')

function writeFileSyncRecursive(filename, content, charset) {
  const folders = filename.split(path.sep).slice(0, -1)
  if (folders.length) {
    // create folder path if it doesn't exist
    folders.reduce((last, folder) => {
      const folderPath = last ? last + path.sep + folder : folder
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath)
      }
      return folderPath
    })
  }
  fs.writeFileSync(filename, content, charset)
}

const ignorePaths = ['core', 'nuxt']

/** Read all base directories and return array paths */
const getBaseRoutes = (): string[] => {
  const files = fs.readdirSync(packagesRoot)
  const baseRoutes = files.filter((pkg) => !ignorePaths.includes(pkg))
  return baseRoutes
}

/** Transform base directory to router path */
const parseBaseRoute = (route: string) => ({
  name: sentenceCase(route.split('c-').pop() || route),
  path: `/${route}`,
})

/** Create child component route */
const createChildPath = (basePath: string, route: string) =>
  `/${basePath}/${route
    .substring(route.lastIndexOf('/') + 1)
    .replace('.vue', '')}`

/** Transform stories to routes */
const parseChildrenRoutes = (basePath: string, routes: string[]) =>
  routes.map((route) => ({
    name: sentenceCase(createChildPath('', route)),
    path: createChildPath(basePath, route),
    component: path
      .relative(playgroundRoot, route)
      .replace('../../packages/', '@chakra-ui/'),
  }))

export interface Route {
  name: string
  path: string
  component?: string
  children?: Route[]
}

/** To import statement */
const toImport = (component: string, importPath: string) =>
  // Note: for now dynamic imports dont work with vite. use static imports
  `const ${component} = () => import('${importPath}')`
// `import ${component} from '${importPath}'`

interface Resolver {
  (resolver: Route): string
}

/** Flatten routes */
const flatten = (routes: Route[], resolver: Resolver): Array<string> => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
  // @ts-ignore
  return (
    routes
      .map((route: Route) =>
        route.children ? flatten(route.children, resolver) : resolver(route)
      )
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      .flat(Infinity)
  )
}

const baseRoutes = getBaseRoutes()

const NotFoundRoute: Route = {
  name: 'NotFound',
  path: '/*',
  component: '../components/Home.vue',
}

const routes: Route[] = [
  {
    name: 'Home',
    path: '/',
    component: '../components/Home.vue',
  },
]

baseRoutes.map((basePath) => {
  try {
    const files = recursiveRead(path.join(packagesRoot, basePath, 'examples'))
    const examples = files.filter((file) => file.endsWith('.vue'))

    const componentRoute: Route = {
      ...parseBaseRoute(basePath),
      ...(examples.length && {
        children: parseChildrenRoutes(basePath, examples),
      }),
    }

    routes.push(componentRoute)
    consola.success(`Loaded examples in ${basePath} package`)
  } catch (error) {
    consola.info(`No examples found in ${basePath} package`)
  }
})

// 404 Route
routes.push(NotFoundRoute)

writeFileSyncRecursive(
  path.join(playgroundRoot, './.generated/routes.json'),
  JSON.stringify(routes, null, 2),
  'utf8'
)

interface RoutesMap {
  [key: string]: string
}

let i = 0
const routesMap: RoutesMap = {}
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const componentLookup = flatten(routes, (route) => route.component!)
  .map((path) => {
    const name = `Component_${++i}`
    routesMap[path] = name
    return path === '../components/Home.vue'
      ? `import ${name} from "${path}";`
      : toImport(name, path)
  })
  .join('\n')

writeFileSyncRecursive(
  path.join(playgroundRoot, './.generated/imports.js'),
  `${componentLookup}\n\nexport default {\n${Object.entries(routesMap)
    .map(([path, name]) => `  "${path}": ${name}`)
    .join(',\n')}\n}`,
  'utf8'
)

writeFileSyncRecursive(
  path.join(playgroundRoot, './.generated/resolver.js'),
  `/* Package components resolver only used in development mode */
  export default {\n${baseRoutes
    .map(
      (pkg) => `  '@chakra-ui/${pkg}': '${packagesRoot}/${pkg}/src/index.ts'`
    )
    .join(',\n')}\n}`,
  'utf8'
)
