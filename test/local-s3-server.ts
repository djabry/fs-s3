import S3rver = require("s3rver");
import S3 from "aws-sdk/clients/s3";
import {mkdtempSync} from "fs";
import {join} from "path";
import {tmpdir} from "os";
import {Credentials} from "aws-sdk";
import del from "del";

export class LocalS3Server {

    private tempDir: string;
    private s3rver: S3rver;
    private hostname: string = "localhost";

    constructor(private port: number = 4569) {
    }

    get endpoint(): string {
        return `http://${this.hostname}:${this.port}`
    }

    createTempDir(): string {
        return mkdtempSync(join(tmpdir(), "fss3-test-")).toString();
    }

    async start(): Promise<void> {
        if (!this.s3rver) {
            this.tempDir = this.createTempDir();
            this.s3rver = new S3rver({
                port: this.port,
                address: this.hostname,
                silent: true,
                directory: this.tempDir
            });
            await this.s3rver.run();
        }
    }

    createClient(): S3 {
       return new S3({
            credentials: new Credentials("S3RVER", "S3RVER"),
            endpoint: this.endpoint,
            sslEnabled: false,
            s3ForcePathStyle: true
        });
    }

    reset() {
        (this.s3rver as any).reset();
    }

    async stop(): Promise<void> {
        await this.s3rver.close();
        await del([this.tempDir], {force: true});
    }
}