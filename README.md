# oapis package manager

This repo shows a proof of concept for a package manager for auto-generated OpenAPI SDKs.

You can use it for any domain that has an `openapi.json` at the root.

To set this up, first you need to instruct npm (or yarn/pnpm, etc) to install anything from the @oapis scope via our server:

```sh
npm config set @oapis:registry https://npm.oapis.org
```

Now, any OpenAPI SDK can be installed using:

```sh
npm i @oapis/{domain}
# or
npm i @oapis/{domain}__{operationId}
```

The proof of concept generates the required files automatically before it serves them such that the installed package is always in sync with the then available OpenAPI spec. This means there is no support for versioning at this point, 1.0.0 is always the most revent version upon installation. If desired, we could add version support through a date system at a later point, having it generate version YYYY.MMDD.HHMM every time someone fetches the available versions and there is a difference from the previous OpenAPI. Another option would be to use the version flag available in the OpenAPI itself, but this may not be updated by all openapi creators.

The proof of concept does not generate valid typescript/javascript code yet. However, my previous experience is that this is quite straightforward to do for the majority of OpenAPIs.

TODO:

- ensure generated JS is valid
- also auto-generate `.d.ts`
- use `.d.ts` to generate docs as well
- allow for openapis available at paths other than root /openapi.json (e.g. `/v1/openapi.json` or `/api/openapi.json`) by normalizing `__` into `/`.
- expose HTML at https://oapis.org/{domain}/{operationId}
- make it deno-compatible as well, including for deno's URL-import feature.
- make it browser-compatible as well (script src="https://js.oapis.org/{domain}/{operationId}.js")
- add versioning and caching, ensuring to check the openapi.json for a changed version if needed. if needed also auto-bump version number (likely not needed).
