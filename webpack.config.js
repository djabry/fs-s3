"use strict";
/**
 * Created by djabry on 04/06/2016.
 */
/**
 * Created by djabry on 10/05/2016.
 */
Object.defineProperty(exports, "__esModule", { value: true });
var path_1 = require("path");
exports.default = {
    mode: "production",
    entry: path_1.resolve(__dirname, "fs-s3-standalone.ts"),
    output: {
        path: path_1.resolve(__dirname, "dist"),
        filename: "fs-s3-standalone.min.js",
        libraryTarget: "var",
        library: "fss3"
    },
    devtool: "source-map",
    resolve: {
        extensions: [".webpack.js", ".web.js", ".ts", ".js", ".json"]
    },
    externals: {
        // require("jquery") is external and available
        //  on the global var jQuery
        "aws-sdk": "AWS"
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                enforce: "pre",
                loader: "tslint-loader",
                options: {
                    failOnHint: true
                }
            },
            {
                test: /\.ts$/,
                use: "ts-loader"
            }
        ]
    },
    node: {
        fs: "empty"
    },
    plugins: []
};
//# sourceMappingURL=webpack.config.js.map