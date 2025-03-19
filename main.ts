import {
  OpenapiDocument,
  OperationDetails,
  Operation,
  PathItem,
  Server,
} from "./types";
import { generateTypeScript } from "./generateTypescript";
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
 * Generate scoped package metadata
 */
const generateScopedPackageMetadata = (
  scope: string,
  packageName: string,
  operation: Operation,
  openapi: OpenapiDocument,
): any => {
  const fullName = `@${scope}/${packageName}`;
  const description =
    operation.description ||
    operation.summary ||
    `Generated from ${openapi.info.title}`;
  const version = "1.0.0"; // Default version

  return {
    _id: fullName,
    _rev: `1-${Date.now().toString(16)}`,
    name: fullName,
    description,
    "dist-tags": {
      latest: version,
    },
    versions: {
      [version]: {
        name: fullName,
        version,
        description,
        main: "index.js",
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
        },
        dependencies: {},
        dist: {
          shasum: generateShasum(packageName),
          tarball: `https://npm.oapis.org/${scope}/${packageName}/-/${packageName}-${version}.tgz`,
        },
      },
    },
    time: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      [version]: new Date().toISOString(),
    },
    readme: `# ${fullName}\n\n${description}`,
  };
};

async function generateTarball(
  files: { name: string; content: string }[],
): Promise<Uint8Array> {
  // Simple tar header creation (512 bytes per header)
  function createTarHeader(filename: string, size: number): Uint8Array {
    const header = new Uint8Array(512);
    const encoder = new TextEncoder();

    // Set filename - field at offset 0, 100 bytes
    const filenameBytes = encoder.encode(filename);
    header.set(filenameBytes.slice(0, 100), 0);

    // Set file mode (default permissions) - field at offset 100, 8 bytes
    const modeBytes = encoder.encode("0000644 ");
    header.set(modeBytes, 100);

    // Set file size in octal - field at offset 124, 12 bytes
    const sizeString = size.toString(8).padStart(11, "0") + " ";
    const sizeBytes = encoder.encode(sizeString);
    header.set(sizeBytes, 124);

    // Set last modification time - field at offset 136, 12 bytes
    const timeString =
      Math.floor(Date.now() / 1000)
        .toString(8)
        .padStart(11, "0") + " ";
    const timeBytes = encoder.encode(timeString);
    header.set(timeBytes, 136);

    // Set typeflag (normal file) - field at offset 156, 1 byte
    header[156] = 48; // ASCII '0'

    // Calculate and set checksum - field at offset 148, 8 bytes
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    const checksumString = checksum.toString(8).padStart(6, "0") + "\0 ";
    const checksumBytes = encoder.encode(checksumString);
    header.set(checksumBytes, 148);

    return header;
  }

  // Calculate total size for the resulting tarball
  let totalSize = 0;
  for (const file of files) {
    // Header (512 bytes) + content size rounded up to multiple of 512
    const contentSize = new TextEncoder().encode(file.content).length;
    const paddedContentSize = Math.ceil(contentSize / 512) * 512;
    totalSize += 512 + paddedContentSize;
  }

  // Add 1024 bytes for end marker
  totalSize += 1024;

  // Create result buffer
  const result = new Uint8Array(totalSize);
  let offset = 0;

  // Add each file
  for (const file of files) {
    const contentBytes = new TextEncoder().encode(file.content);
    const header = createTarHeader(file.name, contentBytes.length);

    // Add header
    result.set(header, offset);
    offset += 512;

    // Add content
    result.set(contentBytes, offset);
    offset += contentBytes.length;

    // Pad to multiple of 512 bytes
    offset = Math.ceil(offset / 512) * 512;
  }

  // End with two empty blocks
  return result;
}

/**
 * Generate package tarball
 */
const generatePackageTarball = async (
  packageName: string,
  operations: OperationDetails[],
  openapiUrl: string,
): Promise<Uint8Array> => {
  // Create the files for the tarball
  const files: { name: string; content: string }[] = [];

  // Add package.json
  const packageJson = {
    name: packageName,
    version: "1.0.0",
    description: "Generated API client",
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
  const readme = `# ${packageName}\n\n${"Generated API client"}`;

  files.push({
    name: "package/README.md",
    content: readme,
  });

  const typescript = operations
    .map((operation) => generateTypeScript(operation.operation, openapiUrl))
    .join("\n");
  // Add index.js - generate TypeScript and strip types

  files.push({
    name: "package/index.js",
    content: stripTypes(typescript),
  });

  // Generate the tarball
  return await generateTarball(files);
};

/**
 * Generate scoped package tarball
 */
const generateScopedPackageTarball = async (
  scope: string,
  packageName: string,
  version: string,
  operation: Operation,
  openapiUrl: string,
): Promise<Uint8Array> => {
  // Create the files for the tarball
  const files: { name: string; content: string }[] = [];

  const fullName = `@${scope}/${packageName}`;

  // Add package.json
  const packageJson = {
    name: fullName,
    version,
    description:
      operation.description || operation.summary || "Generated API client",
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
  const readme = `# ${fullName}\n\n${
    operation.description || operation.summary || "Generated API client"
  }`;

  files.push({
    name: "package/README.md",
    content: readme,
  });

  // Add index.js - generate TypeScript and strip types
  const typescript = generateTypeScript(operation, openapiUrl);

  files.push({
    name: "package/index.js",
    content: stripTypes(typescript),
  });

  // Generate the tarball
  return await generateTarball(files);
};

/**
 * Utility functions
 */
const generateShasum = (input: string): string => {
  // In a real implementation, you'd generate a real SHA-1 hash
  // For now, we'll just return a placeholder
  return Array.from(Array(40), () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
};

/**
 * Main worker function
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    // Handle different route patterns
    if (pathParts.length === 0) {
      return new Response("npm.oapis.org - OpenAPI-based npm registry", {
        status: 200,
      });
    }

    try {
      // Case 1: /{package} - Get package metadata
      if (pathParts.length === 1) {
        const packageName = pathParts[0];
        return await handlePackageMetadata(packageName);
      }
      // Case 2: /{scope}/{package} - Get scoped package metadata
      if (pathParts.length === 2) {
        const scope = pathParts[0];
        const packageName = pathParts[1];
        return await handleScopedPackageMetadata(scope, packageName);
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
        return await handlePackageTarball(packageName, version);
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
        return await handleScopedPackageTarball(scope, packageName, version);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error("Error handling request:", error);
      return new Response("Internal server error", { status: 500 });
    }
  },
};

async function handlePackageMetadata(packageName: string): Promise<Response> {
  // 1. Fetch OpenAPI spec from the domain that matches the package name
  const normalizedPackageName = getOperationId(packageName);
  const openapi = await fetchOpenApiForDomain(normalizedPackageName);

  if (!openapi) {
    return new Response(
      JSON.stringify({
        error: "not_found",
        reason: "package not found - no OpenAPI spec available",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 2. Get all operations from the OpenAPI spec
  const operations = getOperations(openapi);

  // 3. For non-scoped packages, we now return a single version that includes all operations
  const version = "1.0.0"; // Single version

  const metadata = {
    _id: packageName,
    _rev: `1-${Date.now().toString(16)}`,
    name: packageName,
    description: `API client for ${openapi.info.title}`,
    "dist-tags": {
      latest: version,
    },
    versions: {
      [version]: {
        name: packageName,
        version,
        description: `Complete API client for ${openapi.info.title}`,
        main: "index.js",
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
        },
        dependencies: {},
        // Include information about all operations in the package
        operations: operations.map((details) => ({
          id: details.operationId,
          method: details.method,
          path: details.path,
          summary: details.operation.summary || "",
          description: details.operation.description || "",
        })),
        dist: {
          shasum: generateShasum(packageName),
          tarball: `https://npm.oapis.org/${packageName}/-/${packageName}-${version}.tgz`,
        },
      },
    },
    time: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      [version]: new Date().toISOString(),
    },
    readme: `# ${packageName}\n\nGenerated API client for ${
      openapi.info.title
    }\n\n## Included Operations\n\n${Object.keys(operations)
      .map((operationId) => `- ${operationId}`)
      .join("\n")}`,
  };

  return new Response(JSON.stringify(metadata, undefined, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handlePackageTarball(
  packageName: string,
  version: string,
): Promise<Response> {
  // 1. Fetch OpenAPI spec
  const normalizedPackageName = getOperationId(packageName);
  const openapi = await fetchOpenApiForDomain(normalizedPackageName);

  if (!openapi) {
    return new Response(
      JSON.stringify({
        error: "not_found",
        reason: "package not found - no OpenAPI spec available",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 2. Get all operations
  const operations = getOperations(openapi);

  // 4. Generate tarball
  const tarball = await generatePackageTarball(
    packageName,
    operations,
    openapi.servers?.[0]?.url || `https://${normalizedPackageName}`,
  );

  return new Response(tarball, {
    status: 200,
    headers: { "Content-Type": "application/octet-stream" },
  });
}

async function handleScopedPackageMetadata(
  scope: string,
  packageName: string,
): Promise<Response> {
  // 1. Fetch OpenAPI spec from the scope domain
  const openapi = await fetchOpenApiForDomain(scope);

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
  const normalizedPackageName = getOperationId(packageName);
  const matchingOperation = operations.find(
    (x) => x.operationId.toLowerCase() === normalizedPackageName.toLowerCase(),
  );
  if (!matchingOperation) {
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

  // 3. Generate metadata for the specific operation
  const metadata = generateScopedPackageMetadata(
    scope,
    packageName,
    matchingOperation.operation,
    openapi,
  );

  return new Response(JSON.stringify(metadata, undefined, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleScopedPackageTarball(
  scope: string,
  packageName: string,
  version: string,
): Promise<Response> {
  // 1. Fetch OpenAPI spec from the scope domain
  const openapi = await fetchOpenApiForDomain(scope);

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
  const normalizedPackageName = getOperationId(packageName);
  const matchingOperation = operations.find(
    (x) => x.operationId.toLowerCase() === normalizedPackageName.toLowerCase(),
  );

  if (!matchingOperation) {
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

  // 3. Generate tarball for the specific operation
  const tarball = await generateScopedPackageTarball(
    scope,
    packageName,
    version,
    matchingOperation.operation,
    openapi.servers?.[0]?.url || `https://${scope}`,
  );

  return new Response(tarball, {
    status: 200,
    headers: { "Content-Type": "application/octet-stream" },
  });
}
