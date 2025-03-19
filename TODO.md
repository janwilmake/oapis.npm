# oapis package manager

## TODO: Make it a package manager

1. use `generateTypescript` correctly
2. use swcapi for stripping types
3. use https://www.npmjs.com/package/@gera2ld/tarjs for tar file creation
4. test and see if installation works using `npm config set @oapis:registry https://npm.oapis.org` and `npm i @oapis/{domain}`

GOAL: Use this for any API I made. If that works:

- also auto-generate `.d.ts`
- use `.d.ts` to generate docs as well
- expose HTML at https://oapis.org/{domain}/{operationId}
- make it deno-compatible as well, including for deno's URL-import feature.
- make it browser-compatible as well (script src="https://js.oapis.org/{domain}/{operationId}.js")
- add versioning and caching, ensuring to check the openapi.json for a changed version if needed. if needed also auto-bump version number (likely not needed).
