"""V15.5: user-edited Dockerfile + user-provided image flag on environments

Revision ID: a9d4c7e2b1f0
Revises: e7c1a2b3d4f5
Create Date: 2026-09-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a9d4c7e2b1f0'
down_revision: Union[str, None] = 'e7c1a2b3d4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('environments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('dockerfile_override', sa.Text(), nullable=True))
        batch_op.add_column(
            sa.Column(
                'docker_image_custom', sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )


def downgrade() -> None:
    with op.batch_alter_table('environments', schema=None) as batch_op:
        batch_op.drop_column('docker_image_custom')
        batch_op.drop_column('dockerfile_override')
