[![CircleCI](https://circleci.com/gh/jabrythehutt/fs-s3.svg?style=svg)](https://circleci.com/gh/jabrythehutt/fs-s3)
<a href="https://codeclimate.com/github/jabrythehutt/fs-s3/maintainability"><img src="https://api.codeclimate.com/v1/badges/4b67a943ce875e772b75/maintainability" /></a>
<a href="https://codeclimate.com/github/jabrythehutt/fs-s3/test_coverage"><img src="https://api.codeclimate.com/v1/badges/4b67a943ce875e772b75/test_coverage" /></a>

# FS-S3
This project provides an abstraction layer that covers some common read and write operations relating to the Node file system and AWS S3. 

It's currently a work in progress, you can use the [old version](https://github.com/jabrythehutt/fs-s3/tree/v0.3.14) until this is published.

## Why
I found myself re-implementing the following procedures in various projects:
* Copy a local folder to S3
* Skip existing files
* Delete files in an S3 folder

This module makes these operations quicker without 

## Usage

### Web
```typescript
import {S3FileService} from "@jabrythehutt/fs-s3";
import S3 from "aws-sdk/clients/s3";

const s3 = new S3();
const fileService = new S3FileService(s3);

async function deleteOldFiles() {
    await fileService.delete({
        key: "my/old-files",
        bucket: "my-bucket"
    });
}

```

### Node
```typescript

import {NodeFileService, LocalFileService} from "@jabrythehutt/fs-s3/node";
import {S3FileService} from "@jabrythehutt/fs-s3";
import S3 from "aws-sdk/clients/s3";

const s3 = new S3();
const fileService = new NodeFileService(new LocalFileService(), new S3FileService(s3));

async function localToS3() {
    const source = {
        key: "/tmp/myfolder"
    };
    const destination = {
        bucket: "my-bucket",
        key: "foo/mynewfolder"
    }
    await fileService.copy({source, destination});
}


```



