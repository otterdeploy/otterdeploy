import { publicProcedure } from "../..";

const envs = [
  { id: "1", name: "Development", slug: "dev" },
  { id: "2", name: "Staging", slug: "staging" },
];

export const envRouter = {
  get: publicProcedure.env.get.handler(({ input, errors }) => {
    const env = envs.find((env) => env.id === input.id);
    if (!env) throw errors.NOT_FOUND();
    return env;
  }),

  list: publicProcedure.env.list.handler(() => {
    return envs;
  }),
  create: publicProcedure.env.create.handler(({ input }) => {
    envs.push(input);
    return input;
  }),
};
