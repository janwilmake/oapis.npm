export const stripTypes = async (typescript: string) => {
  return typescript;

  // const javascript = (
  //   await fetch("https://swcapi.com/swc/strip-types", {
  //     method: "POST",
  //     body: JSON.stringify([typescript]),
  //   }).then((res) => res.json())
  // )?.[0] as string;

  // return javascript;
};
