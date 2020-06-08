import {FpOptional, GenericFileService} from "../src/file-service";
import {
    CopyOptions,
    CopyRequest,
    DeleteOptions,
    FileContent,
    LocalFile, Optional,
    Scanned,
    WriteOptions,
    WriteRequest
} from "../src/api";
import {expect} from "chai";
import {basename} from "path";
import {FileInfo} from "./file.info";
import {createHash} from "crypto";
import {getType} from "mime";
import {pipe} from "fp-ts/lib/pipeable";
import {fold, fromNullable} from "fp-ts/lib/Option";

export class FileServiceTester<T extends LocalFile, W> {

    constructor(private fileService: GenericFileService<T, W>) {
    }

    async testWriteRead(request: WriteRequest<T>, options: WriteOptions & W) {
        await this.fileService.write(request, options);
        await this.testRead(request.destination, FpOptional.of(request.body));
    }

    async testRead(file: T, expectedContent: Optional<FileContent>) {
        const content = await this.fileService.read(file);
        const locationString = this.fileService.toLocationString(file);
        pipe(
            fromNullable(expectedContent.value),
            fold(
                () => expect(content.exists).to.equal(false,
                    `Didn't expect to read a value for ${locationString}`),
                v => expect(content.exists).to.equal(true, `Expected to get a value for ${locationString}`)  &&
                    expect(content.value.toString()).to.equal(expectedContent.value.toString(), "Didn't read the expected value")
            )
        );
    }

    md5(input: FileContent): string {
        const hash = createHash("md5");
        hash.update(input.toString());
        return hash.digest("hex");
    }

    size(input: FileContent): number {
        return Buffer.byteLength(input.toString());
    }

    async testWriteScan(request: WriteRequest<T>, options: WriteOptions & W) {
        await this.fileService.write(request, options);
        const expectedScan = FpOptional.of({
            ...request.destination,
            size: this.size(request.body),
            md5: this.md5(request.body),
            mimeType: getType(request.destination.key)
        });
        await this.testScan(request.destination, expectedScan);
    }

    async testScan(file: T, expected: Optional<Scanned<T>>) {
        expect((await this.fileService.scan(file)).value).to.deep.equal(expected.value,
            `Didn't get the expected scan result for ${this.fileService.toLocationString(file)}`);
    }

    describeFile(input: Scanned<T>): FileInfo {
        return {
            fileName: basename(input.key),
            md5: input.md5,
            mimeType: input.mimeType,
            size: input.size
        };
    }

    async collectAll(folder: T): Promise<Scanned<T>[]> {
        const list = await this.fileService.list(folder);
        const collectedFiles = [];
        for await (const items of list) {
            collectedFiles.push(...items);
        }
        return collectedFiles;
    }

    async testCopyList<A extends T, B extends T>(request: CopyRequest<A, B>, options: CopyOptions<A, B> & W) {
        const sourceFiles = await this.collectAll(request.source);
        await this.fileService.copy(request, options);
        await this.testList(request.destination, sourceFiles.map(f => this.describeFile(f)));
    }

    async testList(folder: T, expectedFiles: FileInfo[]) {
        const content = await this.collectAll(folder);
        const describe = f => this.describeFile(f);
        expect(content.map(describe)).to.deep.equal(expectedFiles,
            `Didn't find the expected files in ${this.fileService.toLocationString(folder)}`);
    }

    async testDelete(file: T, options: DeleteOptions<T>) {
        await this.fileService.delete(file, options);
        const matchingFiles = await this.collectAll(file);
        expect(matchingFiles).to.have.lengthOf(0,
            `Didn't expect to find any files in the deleted folder ${this.fileService.toLocationString(file)}`);
    }

    async testWriteDelete(request: WriteRequest<T>, options: WriteOptions & W, deleteOptions: DeleteOptions<T>) {
        await this.fileService.write(request, options);
        await this.testDelete(request.destination, deleteOptions);
    }
}