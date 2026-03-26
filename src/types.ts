export type JwtPayload = {
    id: string;
    email: string;
    exp: number;
};

export type AppVariables = {
    jwtPayload: JwtPayload;
};

export type AppEnv = { Variables: AppVariables };
