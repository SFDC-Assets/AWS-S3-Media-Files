# Introduction

## Installation and Setup of the AWS Environment

Your AWS IAM user should have the following permissions at a minimum:

```json
{
  "Version": "2012-10-17",
  "Statement": [
     {
        "Effect": "Allow",
        "Action": [
           "s3:DeleteObject",
           "s3:GetObject",
           "s3:ListBucket",
           "s3:PutObject",
           "s3:PutObjectAcl"
        ],
        "Resource": [           
           "arn:aws:s3:::YOUR_S3_BUCKET_NAME_GOES_HERE"
        ]
     }
  ]
}
```

The CORS permissions should be at least:

```json
[
  {
      "AllowedHeaders": [
          "*"
      ],
      "AllowedMethods": [
          "HEAD",
          "GET",
          "PUT",
          "POST",
          "DELETE"
      ],
      "AllowedOrigins": [
          "*"
      ],
      "ExposeHeaders": [
          "ETag"
      ]
  }
]
```
