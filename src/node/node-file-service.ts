import {getType} from "mime";
import {
    copyFileSync,
    createReadStream,
    existsSync,
    readdirSync,
    readFileSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "fs";
import {createHash} from "crypto";
import {join, normalize, parse, sep} from "path";
import mkdirp from "mkdirp";
import {
    AnyFile,
    CopyOperation,
    CopyOptions,
    CopyRequest,
    FileContent,
    LocalFile,
    Optional,
    S3File,
    Scanned,
    ScannedFile,
    ScannedS3File,
    WriteRequest
} from "../api";
import {FpOptional, GenericFileService} from "../file-service";
import {S3FileService, S3WriteOptions} from "../s3";
import {bimap, Either, fold, left, right} from "fp-ts/lib/Either";
import {pipe} from "fp-ts/lib/pipeable";
import {Readable} from "stream";
import {OverwriteOptions} from "../api/overwrite-options";
import S3 from "aws-sdk/clients/s3";
import {partition} from "fp-ts/lib/Array";

export class NodeFileService extends S3FileService implements GenericFileService<AnyFile, S3WriteOptions> {

    constructor(s3Promise: S3 | Promise<S3>, private localFilePollPeriod: number = 100) {
        super(s3Promise);
    }

    protected async sleep(period: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, period));
    }

    protected async waitForLocalFile(localFile: LocalFile): Promise<void> {
        while (!existsSync(localFile.key)) {
            await this.sleep(this.localFilePollPeriod);
        }
    }

    async deleteLocalFile(f: LocalFile): Promise<void> {
        unlinkSync(f.key);
    }

    protected toEither<T extends S3File, L extends LocalFile>(f: AnyFile): Either<T, L> {
        return this.isS3File(f) ? left(this.toS3File(f)) : right(this.toLocalFile(f));
    }

    protected async waitForFileToExist(file: AnyFile): Promise<void> {
        return pipe(
            this.toEither(file),
            fold(f => super.waitForFileToExist(f), f => this.waitForLocalFile(f))
        );
    }

    async ensureDirectoryExistence(localFile: LocalFile): Promise<void> {
        const fileInfo = parse(localFile.key);
        await mkdirp(fileInfo.dir);
    }

    protected directoryExists(dirPath: string) {
        return existsSync(dirPath) && statSync(dirPath).isDirectory();
    }

    protected async calculateStreamMD5(stream: Readable): Promise<string> {
        const hash = createHash("md5");
        for await (const chunk of stream) {
            hash.update(chunk, "utf8");
        }
        return hash.digest("hex");
    }

    private calculateLocalMD5(file: LocalFile): Promise<string> {
        return this.calculateStreamMD5(createReadStream(file.key));
    }


    async readFile(file: ScannedFile): Promise<FileContent> {
        return pipe(
            this.toEither<ScannedS3File, Scanned<LocalFile>>(file),
            fold(
                f => super.readFile(f),
                async f => readFileSync(file.key)
            )
        )
    }

    scan<T extends LocalFile>(file: T): Promise<Optional<Scanned<T>>> {
        return pipe(
            this.toEither(file),
            fold(
                f => super.scan(f),
                f => this.scanLocalFile(f)
            )
        ) as Promise<Optional<Scanned<T>>>;
    }

    protected async deleteFile<T extends Scanned<LocalFile>>(file: T): Promise<void> {
        return pipe(
            this.toEither<ScannedS3File, Scanned<LocalFile>>(file),
            fold(f => super.deleteFile(f), f => this.deleteLocalFile(f))
        );
    }

    protected async scanLocalFile(file: LocalFile): Promise<Optional<Scanned<LocalFile>>> {
        if (existsSync(file.key)) {
            const fileInfo = statSync(file.key);
            if (fileInfo.isFile()) {
                return FpOptional.of({
                    ...file,
                    md5: await this.calculateLocalMD5(file),
                    size: statSync(file.key).size,
                    mimeType: getType(file.key)
                })
            }
        }
        return FpOptional.empty();
    }

    list<T extends LocalFile>(fileOrFolder: T): AsyncIterable<Scanned<T>[]> {
        return pipe(
            this.toEither(fileOrFolder),
            fold(
                f => super.list(f),
                f => this.listLocal(f)
            )
        ) as AsyncIterable<Scanned<T>[]>;
    }

    protected existingOnly<T>(items: Optional<T>[]): T[] {
        return items.filter(item => item.exists).map(item => item.value);
    }

    protected async *listLocal(file: LocalFile): AsyncIterable<Scanned<LocalFile>[]> {
        const fileStats = statSync(file.key);
        if (fileStats.isFile()) {
            const scannedFiles = [await this.scanLocalFile(file)];
            yield this.existingOnly(scannedFiles);
        } if (fileStats.isDirectory()) {
            const filePaths = readdirSync(file.key)
                .map(p => join(file.key, p)).map(key => ({key}));
            const partitions = partition((p: LocalFile) => statSync(p.key).isFile())(filePaths);
            const scannedFiles = await Promise.all(partitions.left.map(p => this.scanLocalFile(p)));
            yield this.existingOnly(scannedFiles);
            for(const dir of partitions.right) {
                yield* this.listLocal(dir);
            }
        }
    }

    async copy<A extends AnyFile, B extends AnyFile>(request: CopyRequest<A, B>,
                                                     options: CopyOptions<A, B> & S3WriteOptions): Promise<void> {
        return super.copy(request as CopyRequest<S3File, S3File>,
            options as CopyOptions<S3File, S3File> & S3WriteOptions);
    }

    toLocationString(input: AnyFile): string {
        return pipe(
            this.toEither(input),
            fold(
                s3File => super.toLocationString(s3File),
                localFile => localFile.key
            )
        )

    }

    protected async writeFile(request: WriteRequest<AnyFile>,
                              options: OverwriteOptions & S3WriteOptions): Promise<void> {
        const mapBoth = (f) => bimap(f, f);
        return pipe(
            this.toEither(request.destination),
            mapBoth(f => ({...request, destination: f})),
            fold(
                (s3Request: WriteRequest<S3File>) => super.writeFile(s3Request, options),
                async (localRequest: WriteRequest<LocalFile>) => writeFileSync(request.destination.key, request.body)
            )
        )
    }

    protected async copyFile<A extends AnyFile, B extends AnyFile>(request: CopyOperation<A, B>,
                                                         options: CopyOptions<A, B> & S3WriteOptions): Promise<void> {

        const mapBoth = f => bimap(f, f);
        const correctedRequest = pipe(
            this.toEither(request.source),
            mapBoth(source => ({
                ...request,
                source
            })),
            mapBoth(r => pipe(
                this.toEither(r.destination),
                mapBoth(destination => ({...r, destination}))
            ))
        )

        const foldNested = (a, b, c, d) => fold(
            fold(a, b),
            fold(c, d)
        );

        return pipe(
            correctedRequest,
            foldNested(
                s3ToS3 => super.copyFile(s3ToS3, options as CopyOptions<S3File, S3File>),
                s3ToLocal => this.copyS3ToLocal(s3ToLocal, options as CopyOptions<S3File, LocalFile>),
                localToS3 => this.copyLocalToS3(localToS3, options as CopyOptions<LocalFile, S3File>),
                localToLocal => this.copyLocalToLocal(localToLocal, options as CopyOptions<LocalFile, LocalFile>)
            )
        ) as Promise<void>;

    }


    protected async copyLocalToS3(request: CopyOperation<LocalFile, S3File>,
                        options: CopyOptions<LocalFile, S3File> & S3WriteOptions): Promise<void> {
        await this.writeFile({
            body: readFileSync(request.source.key),
            destination: request.destination
        }, options);
    }

    protected async copyS3ToLocal(request: CopyOperation<S3File, LocalFile>,
                        options: CopyOptions<S3File, LocalFile>): Promise<void> {
        await this.ensureDirectoryExistence(request.destination);
        const body = await this.read(request.source);
        writeFileSync(request.destination.key, body);
    }

    protected async copyLocalToLocal(request: CopyOperation<LocalFile, LocalFile>,
                           options: CopyOptions<LocalFile, LocalFile>): Promise<void> {
        await this.ensureDirectoryExistence(request.destination);
        copyFileSync(request.source.key, request.destination.key);
    }

    protected isS3File(input: AnyFile): boolean {
        return !!(input as S3File).bucket;
    }

    protected toLocalPath(s3Key: string): string {
        return s3Key.split("/").join(sep);
    }

    protected toLocalFile<T extends LocalFile>(file: AnyFile): T {
        return this.isS3File(file) ? file as T : {
            ...file,
            key: normalize(this.toLocalPath(file.key))
        } as T;
    }

    protected toS3File<T extends S3File>(destination: AnyFile): T {
        return this.isS3File(destination) ? {
            ...destination,
            key: this.toS3Key(destination.key)
        } as T : destination as T;
    }

    protected replacePathSepsWithForwardSlashes(input: string): string {
        return input.split(sep).join("/");
    }

    protected stripPrefixSlash(input: string): string {
        return input.startsWith("/") ? input.replace("/", "") : input;
    }

    protected toS3Key(input: string): string {
        return this.stripPrefixSlash(this.replacePathSepsWithForwardSlashes(input));
    }

}
