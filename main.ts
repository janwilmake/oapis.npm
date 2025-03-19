import {
  OpenapiDocument,
  OperationDetails,
  Operation,
  PathItem,
} from "./types";
import { generateTypeScript } from "./generateTypescript";
import { stripTypes } from "./stripTypes";
import { TarWriter } from "@gera2ld/tarjs";

type Env = {
  OAPIS_KV: KVNamespace;
};

/**
 * Main worker function
 */
export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = decodeURIComponent(url.pathname).split("/").slice(2);

    // Handle different route patterns
    if (pathParts.length === 0) {
      return new Response("npm.oapis.org - OpenAPI-based npm registry", {
        status: 200,
      });
    }

    console.log({ pathParts });
    try {
      // Case 1: /{package} - Get package metadata
      if (pathParts.length === 1) {
        const packageName = pathParts[0];
        return await handlePackageMetadata(env, packageName);
      }

      // Case 2: /{scope}/{package} - Get scoped package metadata
      if (pathParts.length === 2) {
        const scope = pathParts[0];
        const packageName = pathParts[1];
        return await handlePackageMetadata(env, scope, packageName);
      }

      // Case 3: /{package}/-/{package}-{version}.tgz - Download package tarball
      if (
        pathParts.length === 3 &&
        pathParts[1] === "-" &&
        pathParts[2].endsWith(".tgz")
      ) {
        const packageName = pathParts[0];
        const versionFilename = pathParts[2];
        const version = versionFilename.slice(packageName.length + 1, -4); // Extract version
        return await handlePackageTarball(packageName, version, env);
      }

      // Case 4: /{scope}/{package}/-/{package}-{version}.tgz - Download scoped package tarball
      if (
        pathParts.length === 4 &&
        pathParts[2] === "-" &&
        pathParts[3].endsWith(".tgz")
      ) {
        const scope = pathParts[0];
        const packageName = pathParts[1];
        const versionFilename = pathParts[3];
        const version = versionFilename.slice(packageName.length + 1, -4); // Extract version
        return await handlePackageTarball(
          scope + "/" + packageName,
          version,
          env,
        );
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error("Error handling request:", error);
      return new Response("Internal server error", { status: 500 });
    }
  },
};
/**
 * Creates a tarball from an array of files, compresses it with gzip, and calculates its SHA1 hash
 */
async function generatePackageTarballWithShasum(
  files: Array<{ name: string; content: string }>,
) {
  try {
    // Create a TarWriter instance
    const writer = new TarWriter();

    // Add each file to the tarball
    for (const file of files) {
      const { name, content } = file;

      // Handle string or binary content appropriately
      if (typeof content === "string") {
        writer.addFile(name, content);
      } else if (
        (content as any) instanceof ArrayBuffer ||
        (content as any) instanceof Uint8Array
      ) {
        writer.addFile(name, content);
      } else {
        // For other content types, try to convert to string
        writer.addFile(name, String(content));
      }
    }

    // Write the tarball to a Blob
    const tarBlob = await writer.write();

    // Convert the tar Blob to an ArrayBuffer
    const tarBuffer = await tarBlob.arrayBuffer();

    // Compress the tar with gzip
    // Note: In Cloudflare Workers, you can use the CompressionStream API
    const gzipStream = new CompressionStream("gzip");
    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(tarBuffer));
        controller.close();
      },
    });

    const compressedStream = readableStream.pipeThrough(gzipStream);
    const compressedResponse = new Response(compressedStream);
    const tarballBuffer = await compressedResponse.arrayBuffer();

    // Calculate SHA1 hash using Web Crypto API
    const hashBuffer = await crypto.subtle.digest("SHA-1", tarballBuffer);

    // Convert the hash to a hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const shasum = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Return an object with the tarball ArrayBuffer and shasum
    return {
      files,
      tarballBuffer,
      shasum,
    };
  } catch (error) {
    console.error("Error generating tarball:", error);
    throw error;
  }
}
/**
 * Creates a tarball Response from an ArrayBuffer
 */
export function createTarballResponse(
  buffer: ArrayBuffer,
  filename = "archive.tar",
) {
  // Return the Response with the ArrayBuffer
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/gzip", // Changed from application/x-tar to application/gzip
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * Generate and store package tarball
 */
async function generateAndStorePackageTarball(
  packageName: string,
  version: string,
  files: Array<{ name: string; content: string }>,
  env: Env,
): Promise<{ shasum: string; tarballKey: string }> {
  // Generate the tarball
  const { tarballBuffer, shasum } = await generatePackageTarballWithShasum(
    files,
  );

  // Create a unique key for KV storage
  const tarballKey = `tarball:${packageName}:${version}`;
  console.log({ shasum });
  // Store the ArrayBuffer directly in KV with TTL of 60 seconds
  await env.OAPIS_KV.put(tarballKey, tarballBuffer, {
    expirationTtl: 60,
    metadata: { shasum },
  });

  return { shasum, tarballKey };
}

/**
 * Handle package tarball request
 */
async function handlePackageTarball(
  packageName: string,
  version: string,
  env: Env,
): Promise<Response> {
  try {
    // Try to find the tarball metadata first
    // Use the most recent stored tarball
    const value = await env.OAPIS_KV.get(
      `tarball:${packageName}:${version}`,
      "arrayBuffer",
    );

    if (value) {
      return createTarballResponse(value, `${packageName}-${version}.tgz`);
    }

    return new Response("Error serving package tarball", { status: 500 });
  } catch (error) {
    console.error("Error serving package tarball:", error);
    return new Response("Error serving package tarball", { status: 500 });
  }
}

/**
 * Core utility functions
 */
const tryParseJson = <T extends unknown>(text: string): T | null => {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error("JSON Parse error:", error);
    return null;
  }
};

const tryParseYamlToJson = <T = any>(yamlString: string): T | null => {
  try {
    // In a real implementation, you'd use a YAML parsing library
    // Since this is a demo, we'll just return null
    return null;
  } catch (e: any) {
    return null;
  }
};

const getOperationId = (packageName: string): string => {
  return packageName.replaceAll("__", "/");
};

/**
 * OpenAPI fetching and processing
 */
const fetchOpenApiForDomain = async (
  domain: string,
): Promise<OpenapiDocument | null> => {
  // If domain contains a dot, use it as a full hostname, otherwise append .com
  const hostname = domain.includes(".") ? domain : `${domain}.com`;
  const url = `https://${hostname}/openapi.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const text = await response.text();
    const json = tryParseJson<OpenapiDocument>(text);
    if (json && json.paths) {
      return json;
    }

    const yamlJson = tryParseYamlToJson<OpenapiDocument>(text);
    if (yamlJson && yamlJson.paths) {
      return yamlJson;
    }
  } catch (error) {
    console.error(`Error fetching OpenAPI from ${url}:`, error);
  }

  return null;
};

/**
 * Extract operations from OpenAPI
 */
const getOperations = (openapi: OpenapiDocument): OperationDetails[] => {
  const operations: {
    operationId: string;
    method: string;
    path: string;
    operation: Operation;
  }[] = [];

  for (const [path, pathItem] of Object.entries(openapi.paths)) {
    const methods = ["get", "post", "put", "patch", "delete"];

    for (const method of methods) {
      const operation = pathItem[method as keyof PathItem] as
        | Operation
        | undefined;
      if (!operation || !operation.operationId) continue;

      operations.push({
        operationId: operation.operationId,
        method,
        path,
        operation,
      });
    }
  }

  return operations;
};

/**
 * Generate files array for package
 */
async function generatePackageFiles(
  packageName: string,
  openapi: OpenapiDocument,
  operations: OperationDetails[],
  openapiUrl: string,
): Promise<Array<{ name: string; content: string }>> {
  // Create the files for the tarball
  const files: { name: string; content: string }[] = [];

  // Add package.json
  const packageJson = {
    name: packageName,
    version: "1.0.0",
    description: `API client for ${openapi.info.title}`,
    main: "index.js",
    scripts: {
      test: 'echo "Error: no test specified" && exit 1',
    },
    dependencies: {},
    author: "npm.oapis.org",
    license: "MIT",
  };

  files.push({
    name: "package/package.json",
    content: JSON.stringify(packageJson, null, 2),
  });

  // Add README.md
  const readme = `# ${packageName}\n\nGenerated API client for ${openapi.info.title}`;

  files.push({
    name: "package/README.md",
    content: readme,
  });

  const typescript = operations
    .map((operation) => generateTypeScript(openapi, operation, openapiUrl))
    .join("\n");
  // Add index.js - generate TypeScript and strip types

  files.push({
    name: "package/index.js",
    content: await stripTypes(typescript),
  });

  return files;
}

async function handlePackageMetadata(
  env: Env,
  domain: string,
  operationId?: string,
): Promise<Response> {
  // 1. Fetch OpenAPI spec from the scope domain
  const openapi = await fetchOpenApiForDomain(domain);

  if (!openapi) {
    return new Response(
      JSON.stringify({
        error: "not_found",
        reason: "package not found - no OpenAPI spec available for scope",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 2. Get the operation matching the package name

  const operations = getOperations(openapi);
  const operationsHere = operationId
    ? [
        operations.find(
          (x) =>
            x.operationId.toLowerCase() ===
            getOperationId(operationId).toLowerCase(),
        ),
      ].filter((x) => !!x)
    : operations;

  if (operationsHere.length === 0) {
    return new Response(
      JSON.stringify({
        error: "not_found",
        reason: "operation not found for package name",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const version = "1.0.0";
  const fullName = operationId ? `@${domain}/${operationId}` : domain;

  // 3. Generate files for the tarball
  const files = await generatePackageFiles(
    domain,
    openapi,
    operationsHere,
    openapi.servers?.[0]?.url || `https://${domain}`,
  );

  // 4. Generate and store the tarball, getting the shasum
  const { shasum, tarballKey } = await generateAndStorePackageTarball(
    fullName,
    version,
    files,
    env,
  );

  // 5. Generate metadata for the specific operation
  const metadata = {
    _id: fullName,
    _rev: `1-${Date.now().toString(16)}`,
    name: fullName,
    description: `Generated from ${openapi.info.title}`,
    "dist-tags": {
      latest: version,
    },
    versions: {
      [version]: {
        name: fullName,
        version,
        description: `Generated from ${openapi.info.title}`,
        main: "index.js",
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
        },
        dependencies: {},
        dist: {
          shasum,
          tarball: `https://npm.oapis.org/@oapis/${fullName}/-/${
            operationId || domain
          }-${version}.tgz`,
        },
        _tarballKey: tarballKey, // Store the tarball key for retrieval
      },
    },
    time: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      [version]: new Date().toISOString(),
    },
    readme: `# ${fullName}\n\nGenerated from ${openapi.info.title}`,
  };

  return new Response(JSON.stringify(metadata, undefined, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
