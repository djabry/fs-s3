load("@npm_bazel_typescript//:index.bzl", "ts_library")
load("@npm_bazel_jasmine//:index.bzl", "jasmine_node_test")

def test(srcs, name = "test", deps = []):
    lib_name = native.package_name()
    test_lib_name = name + "_lib"
    ts_library(
        name = test_lib_name,
        srcs = srcs,
        deps = [lib_name] + deps
    )

    jasmine_node_test(
        coverage = True,
        name = name,
        deps = [test_lib_name] + deps
    )